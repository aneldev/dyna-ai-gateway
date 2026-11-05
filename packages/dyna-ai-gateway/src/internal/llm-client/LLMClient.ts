import {
  FinishReason,
  LanguageModel,
  LanguageModelUsage,
  ModelMessage,
  SystemModelMessage,
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
import {
  TSdkProviderOptions,
  toSdkProviderOptions,
} from "./utils/toSdkProviderOptions";
import {toSdkSystem} from "./utils/toSdkSystem";
import {toSdkTools} from "./utils/toSdkTools";
import {withoutInlineBytes} from "./utils/withoutInlineBytes";
import {withoutOutputSchema} from "./utils/withoutOutputSchema";
import {withoutRequestBody} from "./utils/withoutRequestBody";

/** The options both SDK entry points take. */
interface ISdkCallOptions {
  /** The provider's model, from `createLanguageModel`. */
  model: LanguageModel;
  /** The system prompt as the provider takes it: one string, or one message per block with the cache marker. */
  system: string | SystemModelMessage[];
  /** The transcript in SDK shape. */
  messages: ModelMessage[];
  /** The tools the model may request, without executors. */
  tools: ToolSet;
  /** The request's output cap. */
  maxOutputTokens: number;
  /** The request's temperature; undefined for the provider default. */
  temperature: number | undefined;
  /** Retries on transient provider errors (`ILLMClientConfig.maxRetries`). */
  maxRetries: number;
  /** Per call, in ms (`ILLMClientConfig.timeoutMs`). */
  timeout: number;
  /** The caller's signal, when given. */
  abortSignal: AbortSignal | undefined;
  /** The structured-output spec of the request's `outputSchema`; undefined for free text. */
  output: ReturnType<typeof Output.object<unknown>> | undefined;
  /** Call-level provider options: OpenAI's prompt cache key, else undefined. */
  providerOptions: TSdkProviderOptions;
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
  /** The text the model wrote; empty when it only asked for tools. */
  text: string;
  /** The tool requests of the call, unexecuted. */
  toolCalls: Array<{toolCallId: string; toolName: string; input: unknown}>;
  /** The SDK's finish reason, mapped by `FINISH_REASONS`. */
  finishReason: FinishReason;
  /** The provider's usage; undefined when it reported none. */
  usage: LanguageModelUsage | undefined;
  /** The parsed structured output; undefined when none was asked for or it could not be parsed. */
  output: unknown;
}

/**
 * LLMClient -- the one door to every model provider
 *
 * # About
 *
 * > Three doors; the decisions live in hooks.
 *
 * The only class that imports the AI SDK: `complete` makes one model call and may return tool requests it never
 * executes, `run` is the agent loop (`runAgentLoop`) with one `complete` per step and every decision outsourced to
 * `ILLMClientHooks`, `embed` turns texts into vectors. The `modelId` is resolved through the `ModelRegistry`, the credentials
 * come from the config, the provider adapters (`createLanguageModel`, `createEmbeddingModel`, one per `EModelProvider`, D84)
 * and the mappers to the SDK's shapes live in `utils/`. Because every model call passes here, the client also asks the
 * `UsageGuard` before and reports to it after every call (D121), and records every call in the `Trace` under the call's
 * `ILLMClientCallMeta`; the gateway only annotates the entry afterwards. The system prompt arrives as blocks (D123): a
 * provider with a cache marker gets one message per block, the others the texts joined.
 *
 * Sits between the orchestration and the helpers that call a model (`Guardrails`' judge, `QueryRewriter`, the memories,
 * `Embedder`) and the providers behind the SDK.
 *
 * # Who needs it
 *
 * `AIGateway` for the answer and the run; `createJudge`, `QueryRewriter`, `UserMemoryStore`, `updateSummary` for their
 * completions; `Embedder` for `embed`. Constructed once from `IAIGatewayConfig.llmClient`; the tests inject a
 * `FakeLLMClient` through `IAIGatewayDeps.llmClient`.
 *
 * # What needs
 *
 * `ILLMClientConfig`: the credentials per provider, the timeout and the retries. `ILLMClientDeps`: the `ModelRegistry`,
 * the `UsageGuard` and the `Trace`.
 *
 * # Pitfalls
 *
 * The SDK's own loop (`stopWhen`, `ToolLoopAgent`) is not used: a run must pause mid-loop, be stored and continue in another
 * process, so the loop is ours and the SDK sees one call per step. A provider failure is a 502 with the provider's error as
 * `parentError`, stripped of the request body (`withoutRequestBody`): a logger never writes the prompt. An aborted call
 * rejects with the signal's reason, is reported with zero usage and is not traced (D90).
 */
export class LLMClient implements ILLMClient {
  constructor(
    private readonly config: ILLMClientConfig,
    private readonly deps: ILLMClientDeps,
  ) {}

  /**
   * complete -- one model call
   *
   * # About
   *
   * > Checked before, reported and traced after; tool requests come back unexecuted.
   *
   * Resolves the model, refuses a temperature on a model without `caps.temperature` (400, D82), asks the `UsageGuard`
   * (a no rejects with the usage-denied error, 429, and the provider is not called), then makes the SDK call: streamed
   * through `hooks.onEvent` (TEXT_DELTA, then DONE) when hooks are given, generated otherwise. Returns the text, the parsed
   * structured output when the request had a schema, the tool requests as the model made them, the finish reason, the usage
   * and the trace id. After the call the app is told what it used and the entry is recorded, also for a failed or aborted
   * call (then with zero usage and no entry). A provider failure is a 502; an aborted signal rejects with its reason, the
   * partial stream is neither returned nor traced (D90). An answer that does not parse against the schema is returned as
   * text, for the `Guardrails` to report.
   *
   * # Who needs it
   *
   * `AIGateway` for an `ask`; `run`, once per step; `createJudge`, `QueryRewriter`, `UserMemoryStore.extract` and
   * `updateSummary` for their one completion.
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
      system: toSdkSystem({
        blocks: request.system,
        provider: model.provider,
      }),
      messages: toSdkMessages(request.messages),
      tools: toSdkTools({
        tools,
        cacheLast: model.provider === EModelProvider.ANTHROPIC && request.cacheTools === true,
      }),
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      maxRetries: this.config.maxRetries ?? DEFAULT_MAX_RETRIES,
      timeout: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      abortSignal,
      output: request.outputSchema === undefined
        ? undefined
        : Output.object({schema: request.outputSchema}),
      providerOptions: toSdkProviderOptions({
        blocks: request.system,
        provider: model.provider,
      }),
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
        cacheWriteInputTokens: outcome.usage?.inputTokenDetails?.cacheWriteTokens,
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
   * run -- the agent loop
   *
   * # About
   *
   * > One `complete` per step; every decision is a hook the gateway implements.
   *
   * Runs `runAgentLoop` with `complete` as its model call. Each step offers the tools `hooks.prepareStep` returns; a tool
   * request is decided by `hooks.decideToolCall` (ALLOW runs it through `hooks.executeTool`, DENY writes a denied result the
   * model reads, NEEDS_APPROVAL pauses the run, D87), `hooks.endsRun` may end the run after the step with one final step
   * without tools (D86), and `limits.maxSteps` ends it with finishReason LENGTH. A `resume` continues a paused run from its
   * stored messages with the human's decisions. The steps stream through `hooks.onEvent` with their `stepIndex`; DONE is sent
   * once, at the end. The signal ends the loop between steps, in a model call or in a tool: the outcome is ABORTED with the
   * steps that completed (D90).
   *
   * # Who needs it
   *
   * `AIGateway` for a `run` and for a `resume`; `tools` is the set the run starts with, as `prepareCall` resolved it.
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
        /** The policy's text for a rejection, per `callId` (D87), as the pause carried it; a call without one gets `DEFAULT_TOOL_REJECTION_TEXT`. */
        rejectionTexts?: Record<string, string>;
      };
      /**
       * The call's signal: aborts the model call in flight and the tool in flight.
       * The loop then returns ABORTED with the steps that completed.
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
   * embed -- texts to vectors
   *
   * # About
   *
   * > One vector per text, in order; checked, reported and traced like a completion.
   *
   * Refuses a model without `caps.embeddings` (400), asks the `UsageGuard` with the token count of the texts, embeds them in
   * one SDK call under the client's timeout and retries, then reports the usage and records the entry (kind EMBED, no
   * request and no result: the usage is what matters). A provider failure is a 502, after the app was told the call used
   * nothing. An empty list returns an empty list without a call.
   *
   * # Who needs it
   *
   * `Embedder`, for the KB ingestion and the KB search.
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

  /**
   * providers -- the providers with credentials
   *
   * # About
   *
   * > Which of `EModelProvider` this client can call.
   *
   * The providers that have an entry in `ILLMClientConfig.providers`, in enum order. A model of any other provider is a 400
   * when it is called.
   *
   * # Who needs it
   *
   * The real-provider tests, to skip a provider without a key; a host that lists what its gateway can reach.
   */
  public get providers(): EModelProvider[] {
    return Object.values(EModelProvider).filter(provider => this.config.providers[provider] !== undefined);
  }

  /** The config's credentials of the model's provider; a provider without an entry is a 400. */
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

  /** The SDK call without streaming (`generateText`), as one outcome. */
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

  /**
   * The SDK call streamed (`streamText`): every text delta goes to `hooks.onEvent`, then the outcome is assembled.
   * An error the stream reported on the way is thrown after the stream ended.
   */
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
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteInputTokens: usage.cacheWriteInputTokens,
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

  /**
   * Asks the app through the UsageGuard.
   * A no throws the usage-denied error: the provider is not called.
   */
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

  /**
   * An approved call that failed or was aborted.
   * The app is told it used nothing, so a reservation can settle.
   */
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

  /** The provider's failure as a 502, the SDK error as `parentError` without the request body. */
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

/** The factors of a call as the UsageGuard wants them: the meta plus the trace and model ids. */
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
