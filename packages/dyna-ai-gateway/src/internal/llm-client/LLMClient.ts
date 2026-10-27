import {
  FinishReason,
  LanguageModel,
  LanguageModelUsage,
  ModelMessage,
  ToolSet,
  NoObjectGeneratedError,
  Output,
  embedMany,
  generateText,
  streamText,
} from "ai";
import {dynaError} from "dyna-error";
import {randomUUID} from "node:crypto";

import {
  IToolDef,
  IUsage,
  EPartKind,
} from "../../contracts";
import {countTokens} from "../../utils/tokens/countTokens";

import {
  IModelInfo,
  EModelProvider,
} from "../model-registry";
import {IResumeDecision} from "../human-gate";
import {
  IUsageCall,
  IUsageCheckArgs,
  makeUsageDeniedError,
} from "../usage-guard";

import {
  ILLMClient,
  ILLMClientCallMeta,
  ILLMClientConfig,
  ILLMClientDeps,
  ILLMClientHooks,
  IMessage,
  IModelRequest,
  IModelResult,
  IProviderCredentials,
  IRunLimits,
  IRunOutcome,
  EFinishReason,
  ELLMClientEventKind,
} from "./types";
import {runAgentLoop} from "./runAgentLoop";
import {estimateRequestTokens} from "./estimateRequestTokens";
import {createEmbeddingModel} from "./utils/createEmbeddingModel";
import {createLanguageModel} from "./utils/createLanguageModel";
import {toSdkMessages} from "./utils/toSdkMessages";
import {toSdkTools} from "./utils/toSdkTools";
import {withoutInlineBytes} from "./utils/withoutInlineBytes";
import {withoutOutputSchema} from "./utils/withoutOutputSchema";
import {withoutRequestBody} from "./utils/withoutRequestBody";

/** The options both SDK entry points take. */
interface ISdkCallOptions {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  maxOutputTokens: number;
  temperature: number | undefined;
  maxRetries: number;
  timeout: number;
  abortSignal: AbortSignal | undefined;
  output: ReturnType<typeof Output.object<unknown>> | undefined;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;

const FINISH_REASONS: Record<FinishReason, EFinishReason> = {
  "stop": EFinishReason.STOP,
  "length": EFinishReason.LENGTH,
  "content-filter": EFinishReason.CONTENT_FILTER,
  "tool-calls": EFinishReason.TOOL_CALLS,
  "error": EFinishReason.ERROR,
  "other": EFinishReason.STOP,
};

/** What one SDK call gives back, whether it was generated or streamed. */
interface ISdkOutcome {
  text: string;
  toolCalls: Array<{toolCallId: string; toolName: string; input: unknown}>;
  finishReason: FinishReason;
  usage: LanguageModelUsage | undefined;
  /** The parsed structured output; undefined when none was asked for or it could not be parsed. */
  output: unknown;
}

/** The only class that imports the AI SDK. Three doors; decisions live in hooks. */
export class LLMClient implements ILLMClient {
  constructor(
    private readonly config: ILLMClientConfig,
    private readonly deps: ILLMClientDeps,
  ) {}

  /**
   * One model call. May return tool requests; never executes them. Streams text via hooks.onEvent when given.
   * A request with a temperature on a model without caps.temperature is refused (400) before the provider is called (D82).
   * Before the provider is called the UsageGuard asks the app (`check`); a no rejects with the usage-denied error
   * (`isUsageDeniedError`, 429) and the provider is not called. After the call the app is told what it used (`addUsage`), also
   * when the call failed or was aborted — then with zero usage and no trace entry, so an adapter that reserved can settle.
   * A provider failure is thrown as a 502 with the provider's error as parentError.
   * An aborted `abortSignal` rejects with its reason, not a 502: the partial stream is neither returned nor traced (D90).
   */
  public async complete(
    {
      request,
      meta,
      tools = [],
      hooks,
      abortSignal,
    }: {
      request: IModelRequest;
      meta: ILLMClientCallMeta;
      /** Tools the model may request (forced-choice routing). */
      tools?: IToolDef[];
      /** Only onEvent is used. */
      hooks?: Pick<ILLMClientHooks, "onEvent">;
      /**
       * Aborts the provider call; the caller's deadline, next to the client's own timeout.
       * An aborted call rejects with the signal's reason, not with a 502; it is reported to the usage adapter with zero usage
       * and not traced (the provider bills its own count).
       */
      abortSignal?: AbortSignal;
    },
  ): Promise<IModelResult> {
    abortSignal?.throwIfAborted();
    const model = await this.deps.modelRegistry.getModel({modelId: request.modelId});
    if (request.temperature !== undefined && !model.caps.temperature) {
      throw dynaError({
        code: 5376006538701,
        status: 400,
        message: `LLMClient: model [${model.id}] does not accept a temperature (caps.temperature is false); omit it for this model`,
        data: {
          modelId: model.id,
          temperature: request.temperature,
        },
      });
    }
    const traceId = randomUUID();
    await this.askUsageGuard({
      meta,
      traceId,
      modelId: model.id,
      neededTokens: {
        input: estimateRequestTokens({
          request,
          provider: model.provider,
        }),
        output: request.maxOutputTokens,
      },
    });
    const options = {
      model: createLanguageModel({
        model,
        credentials: this.getCredentials(model),
      }),
      system: request.system,
      messages: toSdkMessages(request.messages),
      tools: toSdkTools(tools),
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      maxRetries: this.config.maxRetries ?? DEFAULT_MAX_RETRIES,
      timeout: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      abortSignal,
      output: request.outputSchema === undefined
        ? undefined
        : Output.object({schema: request.outputSchema}),
    };

    const startedAt = Date.now();
    let outcome: ISdkOutcome;
    try {
      outcome = hooks
        ? await this.stream(options, hooks)
        : await this.generate(options);
    }
    catch (error) {
      // The model answered, but its JSON did not parse: that is an output problem (Guardrails reports it), not a provider failure
      if (NoObjectGeneratedError.isInstance(error)) {
        outcome = {
          text: error.text ?? "",
          toolCalls: [],
          finishReason: error.finishReason ?? "other",
          usage: error.usage,
          output: undefined,
        };
      }
      else {
        await this.reportNoUsage({
          meta,
          traceId,
          modelId: model.id,
        });
        // The caller stopped the call: its reason, not a provider failure
        if (abortSignal?.aborted) throw abortSignal.reason;
        throw this.toProviderError(error, model);
      }
    }
    // A stream the caller aborted can end quietly with a partial text: never returned, never traced
    if (abortSignal?.aborted) {
      await this.reportNoUsage({
        meta,
        traceId,
        modelId: model.id,
      });
      abortSignal.throwIfAborted();
    }

    const result: IModelResult = {
      modelId: model.id,
      text: outcome.text,
      structured: outcome.output,
      toolCalls: outcome.toolCalls.map(call => ({
        kind: EPartKind.TOOL_CALL,
        callId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      })),
      finishReason: FINISH_REASONS[outcome.finishReason],
      usage: {
        inputTokens: outcome.usage?.inputTokens ?? 0,
        outputTokens: outcome.usage?.outputTokens ?? 0,
        cachedInputTokens: outcome.usage?.inputTokenDetails?.cacheReadTokens,
      },
      latencyMs: Date.now() - startedAt,
      traceId,
    };
    await this.account({
      meta,
      traceId: result.traceId,
      modelId: result.modelId,
      usage: result.usage,
      request,
      result,
    });
    hooks?.onEvent({
      event: {
        kind: ELLMClientEventKind.DONE,
        stepIndex: 0,
      },
    });
    return result;
  }

  /**
   * The agent loop (`runAgentLoop`), with one `complete` call per step: tools are executed through hooks, the run pauses when
   * decideToolCall says so, writes a denied result when it denies a call (D87), and stops at limits.maxSteps.
   * The tools of each step are the ones `hooks.prepareStep` returns; `tools` is the set the run starts with.
   * `abortSignal` ends the loop between steps, in a model call or in a tool (a policy predicate runs to its end): the outcome is
   * ABORTED with the steps that completed (D90).
   */
  public async run(
    {
      request,
      meta,
      hooks,
      limits,
      parallelToolCalls = true,
      resume,
      abortSignal,
    }: {
      request: IModelRequest;
      meta: ILLMClientCallMeta;
      tools: IToolDef[];
      hooks: ILLMClientHooks;
      limits: IRunLimits;
      /**
       * The tool calls of one step run concurrently (D101); false runs them one after the other.
       *
       * > The profile's `parallelToolCalls`, resolved by the gateway.
       *
       * @default true
       */
      parallelToolCalls?: boolean;
      /** Messages of a paused run plus the human's decisions; omit for a fresh run. */
      resume?: {
        messages: IMessage[];
        /** One per pending call the human decided on; a single decision without `callId` is for the first unresolved call. */
        decisions: IResumeDecision[];
        /** The policy's text for a rejection, per `callId` (D87); a call without one gets `DEFAULT_TOOL_REJECTION_TEXT`. */
        rejectionTexts?: Record<string, string>;
      };
      /**
       * The call's signal; every step's model call and tool runs under it.
       * Aborted: the outcome is ABORTED.
       */
      abortSignal?: AbortSignal;
    },
  ): Promise<IRunOutcome> {
    return runAgentLoop({
      request,
      hooks,
      limits,
      parallelToolCalls,
      resume,
      abortSignal,
      callModel: ({
        messages,
        tools,
        stepIndex,
      }) => this.complete({
        request: {
          ...request,
          messages,
        },
        meta,
        tools,
        abortSignal,
        hooks: {
          // The loop announces DONE once, at the end of the run; a step only streams its text
          onEvent: ({event}): void => {
            if (event.kind === ELLMClientEventKind.DONE) return;
            hooks.onEvent({
              event: {
                ...event,
                stepIndex,
              },
            });
          },
        },
      }),
    });
  }

  /**
   * Text → vectors with an embedding model: one vector per text, in the order of the texts.
   * The model must have caps.embeddings (400 otherwise). The call is checked with the UsageGuard, reported to it and traced like every
   * other (no request or result in the trace entry: the usage is what matters). A provider failure is thrown as a 502, after the
   * usage adapter was told the call used nothing.
   */
  public async embed(
    {
      modelId,
      texts,
      meta,
    }: {
      modelId: string;
      texts: string[];
      meta: ILLMClientCallMeta;
    },
  ): Promise<number[][]> {
    if (!texts.length) return [];
    const model = await this.deps.modelRegistry.getModel({modelId});
    if (!model.caps.embeddings) {
      throw dynaError({
        code: 5372630367369,
        status: 400,
        message: `LLMClient: model [${model.id}] is not an embedding model (caps.embeddings is false)`,
        data: {modelId: model.id},
      });
    }
    const traceId = randomUUID();
    await this.askUsageGuard({
      meta,
      traceId,
      modelId: model.id,
      neededTokens: {
        input: texts.reduce((sum, text) => sum + countTokens({
          text,
          provider: model.provider,
        }), 0),
        output: 0,
      },
    });
    const embeddingModel = createEmbeddingModel({
      model,
      credentials: this.getCredentials(model),
    });

    let embedded: Awaited<ReturnType<typeof embedMany>>;
    try {
      embedded = await embedMany({
        model: embeddingModel,
        values: texts,
        maxRetries: this.config.maxRetries ?? DEFAULT_MAX_RETRIES,
        abortSignal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    }
    catch (error) {
      await this.reportNoUsage({
        meta,
        traceId,
        modelId: model.id,
      });
      throw this.toProviderError(error, model);
    }

    await this.account({
      meta,
      traceId,
      modelId: model.id,
      usage: {
        inputTokens: embedded.usage.tokens,
        outputTokens: 0,
      },
    });
    return embedded.embeddings;
  }

  /** Providers with credentials configured. */
  public get providers(): EModelProvider[] {
    return Object.values(EModelProvider).filter(provider => this.config.providers[provider] !== undefined);
  }

  private getCredentials(model: IModelInfo): IProviderCredentials {
    const credentials = this.config.providers[model.provider];
    if (!credentials) {
      throw dynaError({
        code: 5372567786205,
        status: 400,
        message: `LLMClient: no credentials configured for provider [${model.provider}] (model [${model.id}])`,
        data: {
          provider: model.provider,
          modelId: model.id,
        },
      });
    }
    return credentials;
  }

  private async generate(options: ISdkCallOptions): Promise<ISdkOutcome> {
    const result = await generateText(options);
    return {
      text: result.text,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
      usage: result.usage,
      output: options.output ? result.output : undefined,
    };
  }

  private async stream(options: ISdkCallOptions, hooks: Pick<ILLMClientHooks, "onEvent">): Promise<ISdkOutcome> {
    let streamError: unknown;
    const result = streamText({
      ...options,
      onError: ({error}): void => {
        streamError = error;
      },
    });
    for await (const text of result.textStream) {
      hooks.onEvent({
        event: {
          kind: ELLMClientEventKind.TEXT_DELTA,
          text,
          stepIndex: 0,
        },
      });
    }
    if (streamError !== undefined) throw streamError;

    return {
      text: await result.text,
      toolCalls: await result.toolCalls,
      finishReason: await result.finishReason,
      usage: await result.usage,
      output: options.output ? await result.output : undefined,
    };
  }

  /**
   * Reports one provider call to the UsageGuard (usage and list-price cost) and records its trace entry, with the id the result carries.
   * Neither can fail the call: a cost estimate that throws is logged and the call is reported with cost 0, the UsageGuard logs its
   * adapter's throw, and Trace.record never throws.
   */
  private async account(
    {
      meta,
      traceId,
      modelId,
      usage,
      request,
      result,
    }: {
      meta: ILLMClientCallMeta;
      traceId: string;
      modelId: string;
      usage: IUsage;
      /** Absent for an embedding call. */
      request?: IModelRequest;
      /** Absent for an embedding call. */
      result?: IModelResult;
    },
  ): Promise<void> {
    let costUsd = 0;
    try {
      costUsd = await this.deps.modelRegistry.estimateCostUsd({
        modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
    }
    catch (error) {
      console.error(`Internal error 5372567786203: LLMClient: the cost of the call [${traceId}] could not be estimated`, error);
    }
    await this.deps.usageGuard.addUsage({
      ...toUsageCall(meta, traceId, modelId),
      date: new Date(),
      usage,
      costUsd,
    });
    await this.deps.trace.record({
      entry: {
        id: traceId,
        tenantId: meta.tenantId,
        userId: meta.userId,
        profileId: meta.profileId,
        threadId: meta.threadId,
        runId: meta.runId,
        kind: meta.kind,
        modelId,
        // The trace keeps no copy of an uploaded file (its bytes stay in the FileStore) and no zod schema (code, not data)
        request: request && withoutOutputSchema({
          ...request,
          messages: withoutInlineBytes(request.messages),
        }),
        result,
        usage,
        chunkIds: [],
        issues: [],
        costUsd,
        createdAt: new Date(),
      },
    });
  }

  /** Asks the app through the UsageGuard; a no throws the usage-denied error, so the provider is never called. */
  private async askUsageGuard(
    {
      meta,
      traceId,
      modelId,
      neededTokens,
    }: {
      meta: ILLMClientCallMeta;
      traceId: string;
      modelId: string;
      neededTokens: IUsageCheckArgs["neededTokens"];
    },
  ): Promise<void> {
    const result = await this.deps.usageGuard.check({
      ...toUsageCall(meta, traceId, modelId),
      neededTokens,
    });
    if (!result.approved) {
      throw makeUsageDeniedError({
        traceId,
        tenantId: meta.tenantId,
        result,
      });
    }
  }

  /** A call that was approved but failed or was aborted: the app is told it used nothing, so a reservation can be settled. */
  private reportNoUsage(
    {
      meta,
      traceId,
      modelId,
    }: {
      meta: ILLMClientCallMeta;
      traceId: string;
      modelId: string;
    },
  ): Promise<void> {
    return this.deps.usageGuard.addUsage({
      ...toUsageCall(meta, traceId, modelId),
      date: new Date(),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      costUsd: 0,
    });
  }

  private toProviderError(error: unknown, model: IModelInfo): Error {
    return dynaError({
      code: 5372567786196,
      status: 502,
      message: `LLMClient: the call to [${model.provider}] model [${model.id}] failed: ${error instanceof Error ? error.message : String(error)}`,
      data: {
        provider: model.provider,
        modelId: model.id,
      },
      // Never the request: a JSON logger would write the prompt, the user's facts and the files of the call
      parentError: withoutRequestBody(error),
    });
  }
}

/** The factors of a call as the UsageGuard wants them: the meta plus the ids the LLMClient knows. */
const toUsageCall = (meta: ILLMClientCallMeta, traceId: string, modelId: string): IUsageCall => ({
  traceId,
  tenantId: meta.tenantId,
  userId: meta.userId,
  profileId: meta.profileId,
  modelId,
  kind: meta.kind,
  threadId: meta.threadId,
  runId: meta.runId,
});
