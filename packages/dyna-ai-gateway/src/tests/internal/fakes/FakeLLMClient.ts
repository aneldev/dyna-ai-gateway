import {dynaError} from "dyna-error";

import {
  ILLMClient,
  ILLMClientCallMeta,
  IModelRequest,
  IModelResult,
  IRunOutcome,
  IToolCallPart,
  ITrace,
  IUsage,
  IUsageCall,
  IUsageCheckArgs,
  IUsageGuard,
  EFinishReason,
  ELLMClientEventKind,
  EModelProvider,
  ETraceKind,
} from "../../..";
import {
  estimateRequestTokens,
  makeUsageDeniedError,
  runAgentLoop,
  withoutInlineBytes,
  withoutOutputSchema,
} from "../../../internal";

/** One scripted step of `run()`: a tool request (`toolCall`, or several in `toolCalls`) with an optional `text` before it, or the final `text` alone. */
export interface IFakeRunStep {
  /** The model asks for this one tool. */
  toolCall?: IToolCallPart;
  /** The model asks for these tools in one step, in this order (parallel tool calls). */
  toolCalls?: IToolCallPart[];
  /** With a tool request: the text the model wrote before it ("Let me check…"). Alone: the final answer, ends the run. */
  text?: string;
  /** Tokens of this step. Default: zero. */
  usage?: IUsage;
  /**
   * How long the "model" takes for this step; an abort during it ends the step with the signal's reason.
   * Default: no wait.
   */
  delayMs?: number;
  /** Called the moment the "model" starts this step, before `delayMs`: a test presses "stop" here to abort during the model call. */
  onCalled?: () => void;
}

/** Where the fake books its calls, as the LLMClient does. */
export interface IFakeLLMClientAccounts {
  trace: ITrace;
  /** Asked before every scripted call and told after it, as the LLMClient does. */
  usageGuard: IUsageGuard;
}

/**
 * ILLMClient with scripted results; no model, no SDK.
 * Enqueue what the "model" answers, then let the gateway call `complete` / `run` / `embed`.
 * `run` is the real agent loop (`runAgentLoop`) with the script in place of the model, so tools, approvals, resume,
 * step limits and events behave exactly as with the LLMClient.
 * After `accountTo`, every `complete` and every run step is checked with the usage adapter, reported to it and traced as the LLMClient does it.
 */
export class FakeLLMClient implements ILLMClient {
  /** The arguments of every call, for assertions. */
  public readonly completeCalls: Parameters<ILLMClient["complete"]>[0][] = [];
  public readonly runCalls: Parameters<ILLMClient["run"]>[0][] = [];
  public readonly embedCalls: Parameters<ILLMClient["embed"]>[0][] = [];

  private readonly completeQueues = new Map<ETraceKind, Array<{result: IModelResult; delayMs?: number; onCalled?: () => void}>>();
  private readonly runQueue: IFakeRunStep[] = [];
  private readonly embedQueue: number[][][] = [];
  private traceCount = 0;
  private accounts?: IFakeLLMClientAccounts;
  private toVector?: (text: string) => number[];

  constructor(private readonly configuredProviders: EModelProvider[] = []) {
  }

  /** From now on every call is checked with and reported to this UsageGuard and recorded in this Trace, as the LLMClient does. */
  public accountTo(accounts: IFakeLLMClientAccounts): void {
    this.accounts = accounts;
  }

  /**
   * The result of the next `complete()` call of this kind (default: the main call, CHAT).
   * One queue per kind, so the answer scripted for a helper call (memory, …) is never taken by the main call.
   */
  public enqueueComplete(
    result: IModelResult,
    kind: ETraceKind = ETraceKind.CHAT,
    {
      delayMs,
      onCalled,
    }: {
      /** How long the "model" takes; an abort during it rejects with the signal's reason. Default: no wait. */
      delayMs?: number;
      /** Called the moment the "model" starts, before `delayMs`: a test presses "stop" here to abort during the model call. */
      onCalled?: () => void;
    } = {},
  ): void {
    this.completeQueues.set(kind, [
      ...this.completeQueues.get(kind) ?? [],
      {
        result,
        ...delayMs === undefined ? {} : {delayMs},
        ...onCalled ? {onCalled} : {},
      },
    ]);
  }

  /**
   * Scripts what the model "says" in the next step of `run()`.
   *
   * The fake has no model and no logic of its own: it does not
   * choose tools, it replays this queue in order, one step per model call.
   * A step with a tool request (`toolCall`, or several in `toolCalls`) makes the gateway run (or pause on) those tools
   * in that order, as a model's parallel tool calls; its `text`, if any, is what the model wrote before the request.
   * A step with `text` alone is the final answer and ends the run.
   *
   * Enqueue one step per expected model call, in the order the run will make them.
   *
   * Throws here, at enqueue time, when the step has neither a tool request nor `text`, or both `toolCall` and `toolCalls`.
   * Throws later, inside `run()`, when the run needs a step and the queue is empty (`5372567786061`).
   */
  public enqueueRunStep(step: IFakeRunStep): void {
    const hasToolCalls = step.toolCalls !== undefined && step.toolCalls.length > 0;
    if (step.toolCall !== undefined && hasToolCalls) {
      throw dynaError({
        code: 5372567786028,
        message: "FakeLLMClient: a run step takes toolCall or toolCalls, not both",
        data: {step},
      });
    }
    if (step.toolCall === undefined && !hasToolCalls && step.text === undefined) {
      throw dynaError({
        code: 5375185962781,
        message: "FakeLLMClient: a run step needs a tool request (toolCall, toolCalls) or text",
        data: {step},
      });
    }
    this.runQueue.push(step);
  }

  /**
   * From now on `embed()` computes each vector from its text with this function instead of taking enqueued vectors:
   * the same text always gets the same vector, so what was ingested can be searched.
   */
  public embedWith(toVector: (text: string) => number[]): void {
    this.toVector = toVector;
  }

  /** The vectors of the next `embed()` call. */
  public enqueueEmbed(vectors: number[][]): void {
    this.embedQueue.push(vectors);
  }

  /** Returns the next enqueued result of the call's kind (meta.kind); emits TEXT_DELTA (when there is text) and DONE. Throws when nothing is enqueued. */
  public async complete(
    {
      request,
      meta,
      tools,
      hooks,
      abortSignal,
    }: Parameters<ILLMClient["complete"]>[0],
  ): Promise<IModelResult> {
    this.completeCalls.push({
      request,
      meta,
      tools,
      hooks,
      abortSignal,
    });
    abortSignal?.throwIfAborted();
    const traceId = this.getNextTraceId();
    await this.askUsageGuard({
      meta,
      traceId,
      modelId: request.modelId,
      neededTokens: {
        input: estimateRequestTokens({request}),
        output: request.maxOutputTokens,
      },
    });
    const queued = this.completeQueues.get(meta.kind)?.shift();
    if (!queued) {
      throw dynaError({
        code: 5372567786040,
        message: `FakeLLMClient: complete() was called but no result is enqueued for the kind [${meta.kind}]`,
      });
    }
    const result: IModelResult = {
      ...queued.result,
      traceId,
    };
    queued.onCalled?.();
    try {
      if (queued.delayMs) await waitUnlessAborted(queued.delayMs, abortSignal);
    }
    catch (error) {
      await this.reportNoUsage({
        meta,
        traceId,
        modelId: request.modelId,
      });
      throw error;
    }

    if (result.text) {
      hooks?.onEvent({
        event: {
          kind: ELLMClientEventKind.TEXT_DELTA,
          text: result.text,
          stepIndex: 0,
        },
      });
    }
    hooks?.onEvent({
      event: {
        kind: ELLMClientEventKind.DONE,
        stepIndex: 0,
      },
    });
    await this.account({
      meta,
      request,
      result,
    });
    return result;
  }

  /**
   * Runs the real agent loop (`runAgentLoop`) with the enqueued steps as the model's answers: a `toolCall` step is a tool request,
   * a `text` step the final answer. Throws when the loop asks for a step and none is enqueued.
   */
  public async run(
    {
      request,
      meta,
      tools,
      hooks,
      limits,
      parallelToolCalls,
      resume,
      abortSignal,
    }: Parameters<ILLMClient["run"]>[0],
  ): Promise<IRunOutcome> {
    this.runCalls.push({
      request,
      meta,
      tools,
      hooks,
      limits,
      parallelToolCalls,
      resume,
      abortSignal,
    });
    return runAgentLoop({
      request,
      hooks,
      limits,
      parallelToolCalls,
      resume,
      abortSignal,
      callModel: async ({
        messages,
        stepIndex,
      }): Promise<IModelResult> => {
        const traceId = this.getNextTraceId();
        await this.askUsageGuard({
          meta,
          traceId,
          modelId: request.modelId,
          neededTokens: {
            input: estimateRequestTokens({
              request: {
                ...request,
                messages,
              },
            }),
            output: request.maxOutputTokens,
          },
        });
        const step = this.takeRunStep();
        step.onCalled?.();
        try {
          if (step.delayMs) await waitUnlessAborted(step.delayMs, abortSignal);
        }
        catch (error) {
          await this.reportNoUsage({
            meta,
            traceId,
            modelId: request.modelId,
          });
          throw error;
        }
        if (step.text) {
          hooks.onEvent({
            event: {
              kind: ELLMClientEventKind.TEXT_DELTA,
              text: step.text,
              stepIndex,
            },
          });
        }
        const toolCalls = step.toolCalls ?? (step.toolCall ? [step.toolCall] : []);
        const result: IModelResult = {
          modelId: request.modelId,
          text: step.text ?? "",
          toolCalls,
          finishReason: toolCalls.length > 0 ? EFinishReason.TOOL_CALLS : EFinishReason.STOP,
          usage: step.usage ?? {
            inputTokens: 0,
            outputTokens: 0,
          },
          latencyMs: 0,
          traceId,
        };
        await this.account({
          meta,
          request,
          result,
        });
        return result;
      },
    });
  }

  /** Returns the vectors of `embedWith`'s function when one is set, else the next enqueued vectors. Throws when nothing is enqueued. */
  public async embed(
    {
      modelId,
      texts,
      meta,
    }: Parameters<ILLMClient["embed"]>[0],
  ): Promise<number[][]> {
    this.embedCalls.push({
      modelId,
      texts,
      meta,
    });
    const traceId = this.getNextTraceId();
    await this.askUsageGuard({
      meta,
      traceId,
      modelId,
      neededTokens: {
        input: Math.ceil(texts.join("").length / 4),
        output: 0,
      },
    });
    const vectors = this.toVector ? texts.map(this.toVector) : this.embedQueue.shift();
    if (!vectors) {
      throw dynaError({
        code: 5372567786049,
        message: "FakeLLMClient: embed() was called but no vectors are enqueued",
      });
    }
    await this.accounts?.usageGuard.addUsage({
      ...toUsageCall(meta, traceId, modelId),
      date: new Date(),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      costUsd: 0,
    });
    return vectors;
  }

  public get providers(): EModelProvider[] {
    return [...this.configuredProviders];
  }

  private takeRunStep(): IFakeRunStep {
    const step = this.runQueue.shift();
    if (!step) {
      throw dynaError({
        code: 5372567786061,
        message: "FakeLLMClient: run() needs another step but none is enqueued",
      });
    }
    return step;
  }

  private async account(
    {
      meta,
      request,
      result,
    }: {
      meta: ILLMClientCallMeta;
      request: IModelRequest;
      result: IModelResult;
    },
  ): Promise<void> {
    if (!this.accounts) return;
    await this.accounts.usageGuard.addUsage({
      ...toUsageCall(meta, result.traceId, result.modelId),
      date: new Date(),
      usage: result.usage,
      costUsd: 0,
    });
    await this.accounts.trace.record({
      entry: {
        id: result.traceId,
        tenantId: meta.tenantId,
        userId: meta.userId,
        profileId: meta.profileId,
        threadId: meta.threadId,
        runId: meta.runId,
        kind: meta.kind,
        modelId: result.modelId,
        // As the LLMClient records it: no file bytes in the trace
        request: withoutOutputSchema({
          ...request,
          messages: withoutInlineBytes(request.messages),
        }),
        result,
        usage: result.usage,
        chunkIds: [],
        issues: [],
        costUsd: 0,
        createdAt: new Date(),
      },
    });
  }

  /** As the LLMClient: asks the UsageGuard when one is given; a no throws the usage-denied error and the scripted result is not taken. */
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
    const usageGuard = this.accounts?.usageGuard;
    if (!usageGuard) return;
    const result = await usageGuard.check({
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

  /** As the LLMClient: an approved call that was aborted is reported with zero usage. */
  private async reportNoUsage(
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
    await this.accounts?.usageGuard.addUsage({
      ...toUsageCall(meta, traceId, modelId),
      date: new Date(),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      costUsd: 0,
    });
  }

  private getNextTraceId(): string {
    this.traceCount++;
    return `fake-trace-${this.traceCount}`;
  }
}

/** The factors of a call as the UsageGuard wants them (the LLMClient builds the same). */
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

/** Resolves after `ms`, or rejects with the signal's reason when it is aborted first: the "model" stops writing. */
const waitUnlessAborted = (ms: number, abortSignal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (abortSignal?.aborted) {
    reject(abortSignal.reason);
    return;
  }
  const timer = setTimeout(() => {
    abortSignal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  const onAbort = (): void => {
    clearTimeout(timer);
    reject(abortSignal?.reason);
  };
  abortSignal?.addEventListener("abort", onAbort, {once: true});
});
