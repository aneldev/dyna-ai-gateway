import {ZodType} from "zod";

import {
  EPartKind,
  IIssue,
  ITextPart,
  IToolCallPart,
  IToolDef,
  IToolResultPart,
  IUsage,
  TToolCallPolicyResult,
} from "../../contracts";

import {
  IModelRegistry,
  EModelProvider,
} from "../model-registry";
import {IResumeDecision} from "../human-gate";
import {
  IUsageDeniedErrorData,
  IUsageGuard,
} from "../usage-guard";
import {
  ITrace,
  ETraceKind,
} from "../trace";

/** The numbers the agent loop enforces during a run. `maxOutputTokens` travels in IModelRequest (set by the Assembler from the profile). */
export interface IRunLimits {
  /** Model calls per run: the profile's `maxStepsPerRun`. */
  maxSteps: number;
}

/** Configuration of the LLMClient. Lands in IAIGatewayConfig.llmClient. */
export interface ILLMClientConfig {
  /** Credentials per provider; a provider without an entry is unusable. */
  providers: Partial<Record<EModelProvider, IProviderCredentials>>;
  /** Per model call. Default 60_000. */
  timeoutMs?: number;
  /** Retries on transient provider errors. Default 2. */
  maxRetries?: number;
}

/** Shared instances LLMClient needs; created once by AIGateway and passed as the second constructor argument. */
export interface ILLMClientDeps {
  modelRegistry: IModelRegistry;
  /** Asked before every call and told after it, including helper calls; the app's adapter sits behind it. */
  usageGuard: IUsageGuard;
  /** Every call is recorded here; the gateway annotates the main one. */
  trace: ITrace;
}

/** Who and why, for every LLMClient call. The UsageGuard and the Trace need it; the LLMClient stores nothing. */
export interface ILLMClientCallMeta {
  tenantId: string;
  /** Omitted for system jobs (e.g. KB ingestion). */
  userId?: string;
  /** The profile the call runs on. Omitted for system jobs (e.g. KB ingestion). */
  profileId?: string;
  threadId?: string;
  runId?: string;
  kind: ETraceKind;
}

/**
 * How to reach one provider.
 *
 * `apiKey` is the provider's key; for `EModelProvider.BEDROCK` it is a Bedrock API key (bearer token), not an IAM key pair.
 */
export interface IProviderCredentials {
  apiKey: string;
  /** For proxies or self-hosted gateways. */
  baseUrl?: string;
  /**
   * AWS region of the Bedrock endpoint; `EModelProvider.BEDROCK` only, ignored by the other providers.
   *
   * @example "eu-central-1" - the models must be enabled for the account in that region
   *
   * @default the `AWS_REGION` environment variable, else "us-east-1"
   */
  region?: string;
}

/** One request to a model. Built by ContextAssembler. */
export interface IModelRequest {
  modelId: string;
  /**
   * System prompt as blocks, in order (rendered CHAT_MAIN: the stable block, then the per-call block).
   *
   * > Anthropic gets one system block per entry, marked where `cache` is set; the others get the texts joined
   * > (`joinSystem`), OpenAI with a cache key derived from the `cache` block.
   *
   * @example [{text: "You are the assistant…", cache: true}, {text: "Today is Thursday, 2026-10-29…"}]
   */
  system: ISystemBlock[];
  /**
   * Puts the provider's cache marker on the last tool definition too (Anthropic).
   *
   * > A read point for the tool definitions alone, for calls whose system blocks differ but whose tools do not.
   *
   * Set by the ContextAssembler only when the prompt cache may be shared across tenants: tool definitions are the same
   * for every tenant, so a tools-only entry is always shared.
   *
   * @default false
   */
  cacheTools?: boolean;
  messages: IMessage[];
  /** Zod schema for structured output; omitted = free text. */
  outputSchema?: ZodType;
  maxOutputTokens: number;
  /**
   * Sampling temperature, in the provider's range (OpenAI 0–2, Anthropic 0–1); omit for the provider default.
   * Only on a model whose `caps.temperature` is true: the client refuses it otherwise (400, D82).
   */
  temperature?: number;
}

/** One block of the system prompt; the ContextAssembler splits CHAT_MAIN into a stable and a per-call block. */
export interface ISystemBlock {
  text: string;
  /**
   * Marks the end of the part the provider may cache: everything up to and including this block.
   *
   * > Set on a block that is the same on every call of the profile; a block that changes per call never carries it.
   *
   * @default false
   */
  cache?: boolean;
}

/** A message in LLMClient shape (provider-agnostic, SDK-agnostic). */
export interface IMessage {
  role: EMessageRole;
  parts: TMessagePart[];
}

/** Roles the LLMClient understands. */
export enum EMessageRole {
  USER = "USER",
  ASSISTANT = "ASSISTANT",
  TOOL = "TOOL",
}

/** Content of a message. Files are inlined as bytes here; storage pointers were resolved by the gateway. */
export type TMessagePart =
  | ITextPart
  | IInlineFilePart
  | IToolCallPart
  | IToolResultPart;

/** A file inlined for the model. Built by the gateway from FileStore bytes. */
export interface IInlineFilePart {
  kind: EPartKind.INLINE_FILE;
  mime: string;
  /** Empty in a trace entry and in a stored run: the bytes stay in the FileStore only, a resume loads them again by `fileId` (D108). */
  bytes: Uint8Array;
  name: string;
  /** Id of the stored file the bytes come from. */
  fileId: string;
  /** Number of bytes of the file; kept where `bytes` is emptied. */
  size: number;
}

/** What one model call produced. */
export interface IModelResult {
  modelId: string;
  /** Free text, when any. */
  text: string;
  /** Parsed structured output, when outputSchema was given. */
  structured?: unknown;
  /** Tool requests made in this call (complete: unexecuted; run: executed with results in messages). */
  toolCalls: IToolCallPart[];
  finishReason: EFinishReason;
  usage: IUsage;
  /** Wall time. */
  latencyMs: number;
  /** Trace entry written by the LLMClient; the gateway annotates it. */
  traceId: string;
}

/** Why the model stopped. */
export enum EFinishReason {
  STOP = "STOP",
  LENGTH = "LENGTH",
  TOOL_CALLS = "TOOL_CALLS",
  CONTENT_FILTER = "CONTENT_FILTER",
  ERROR = "ERROR",
}

/**
 * A tool call that waits for a human, with what its policy said: the text the model reads if the human rejects it (D87)
 * and the code for why it waits (D98).
 *
 * Produced by `runAgentLoop` on a pause, one per call that needs approval in the step; the gateway's settlement builds the
 * pause envelope from it.
 */
export interface IPendingCall {
  call: IToolCallPart;
  /** The policy's text for a rejection of this call; omitted = the default. */
  rejectionText?: string;
  /** The policy's code for why this call waits for a human; omitted = none. */
  reasonCode?: string;
}

/** Outcome of a run: finished, paused for a human, or aborted by the caller's signal (D90). */
export interface IRunOutcome {
  status: ERunOutcomeStatus;
  /** Present when DONE. */
  result?: IModelResult;
  /**
   * All messages of the run so far; persisted by the gateway into the RunStore.
   * When ABORTED: the steps that completed, so the tools that ran stay on record; a tool call cut by the abort has no result.
   */
  messages: IMessage[];
  /**
   * Present when PAUSED: the tool calls of the step waiting for a human, in request order, never empty.
   *
   * > Every call the policy held back, with what the model reads on a rejection and why the call waits.
   *
   * A parallel run (D101) decided every call of the step before pausing, so the list holds all of them; a sequential run
   * stops at the first and the list holds one.
   */
  pendingCalls?: IPendingCall[];
  /** Model calls performed in this invocation. */
  steps: number;
  /** Sum over all steps. */
  usage: IUsage;
  /** One trace entry per step; the gateway annotates all of them. */
  traceIds: string[];
  /**
   * Present when the usage adapter refused a step after the first: the run is DONE with finishReason LENGTH and the text so far.
   *
   * > The steps before it stand, their tools have had their effects; the gateway reports the refusal as a WARNING issue.
   */
  usageDenied?: IUsageDeniedErrorData;
  /**
   * Name of the tool that ended the run (D86), when a tool did.
   *
   * > Tells the caller the run stopped because a terminal tool ran, not because the model chose to answer.
   *
   * Set with DONE: after the tool's step the model got one last step without tools to phrase the answer. Also set when the
   * limits cut the run before that final step (finishReason LENGTH).
   */
  endedByTool?: string;
}

/** Run outcome states. */
export enum ERunOutcomeStatus {
  DONE = "DONE",
  PAUSED = "PAUSED",
  /** The call's signal fired: the loop stopped where it was and returned what it had (D90). */
  ABORTED = "ABORTED",
}

/** Decisions and side effects the LLMClient outsources during a run. All implemented by the gateway. */
export interface ILLMClientHooks {
  /**
   * Runs a tool the model asked for; `tools` are the ones the model was offered in that step, the only ones that may run (D72).
   * `abortSignal` is the call's, when the caller gave one: the tool runs under it, and a rejection with its reason ends the run.
   */
  executeTool(args: {
    call: IToolCallPart;
    tools: IToolDef[];
    /** Step of the run (0-based) that asked for the call; reported with a failure. */
    stepIndex: number;
    /** The call's signal, when the caller gave one; the tool runs under it. */
    abortSignal?: AbortSignal;
  }): Promise<unknown>;
  /** The verdict on this call before it runs (D87): ALLOW executes it, DENY writes a denied result, NEEDS_APPROVAL pauses the run. May look something up (a tool's own predicate). */
  decideToolCall(args: {
    call: IToolCallPart;
  }): TToolCallPolicyResult | Promise<TToolCallPolicyResult>;
  /** Tools visible for the next step (guarded workflows). */
  prepareStep(args: {
    stepIndex: number;
    executed: string[];
  }): IToolDef[];
  /**
   * True = this executed tool call ends the run (D86). Asked right after `executeTool` returned; never for a call that failed.
   * `tools` are the ones the model was offered in that step.
   */
  endsRun(args: {
    call: IToolCallPart;
    /** What `executeTool` returned. */
    output: unknown;
    tools: IToolDef[];
  }): boolean | Promise<boolean>;
  /** Streaming and progress; the gateway hands them to the call's `events` (D38). */
  onEvent(args: {
    event: ILLMClientEvent;
  }): void;
}

/** One streamed event. */
export interface ILLMClientEvent {
  kind: ELLMClientEventKind;
  /** Text chunk for TEXT_DELTA. */
  text?: string;
  /** Tool call for TOOL_REQUEST / TOOL_RESULT / RUN_ENDED_BY_TOOL (the call that ended it). */
  toolCall?: IToolCallPart;
  /** For RUN_PAUSED: the tool calls the run waits on, in request order (D102); absent when the answer waits for a review (D99). */
  toolCalls?: IToolCallPart[];
  /** Tool output for TOOL_RESULT. */
  toolOutput?: unknown;
  /** For ANSWER_WITHDRAWN: the issues of the output check, or the one issue of an abort; the same the FAILED response carries. */
  issues?: IIssue[];
  stepIndex: number;
}

/** Event kinds a client can render as progress. */
export enum ELLMClientEventKind {
  TEXT_DELTA = "TEXT_DELTA",
  /**
   * The model asked for a tool call; its TOOL_RESULT follows once the tool answered. A call the abort cut (D90) gets no
   * TOOL_RESULT event: the response says the call failed, and the thread holds the error result.
   */
  TOOL_REQUEST = "TOOL_REQUEST",
  TOOL_RESULT = "TOOL_RESULT",
  RUN_PAUSED = "RUN_PAUSED",
  /**
   * A tool with `endsRun` ran (D86): sent once, after the STEP_END of its step and before the final step that phrases the answer.
   * A client can show "handed over" before the closing text streams.
   */
  RUN_ENDED_BY_TOOL = "RUN_ENDED_BY_TOOL",
  STEP_END = "STEP_END",
  DONE = "DONE",
  ERROR = "ERROR",
  /**
   * The answer streamed by this call is not kept (D74): it failed the output checks, or the call was aborted while they ran
   * (D90). The last event of the call, after DONE. A client drops or greys the text it rendered for the call and shows
   * `issues`; the response is FAILED with the same issues. An abort during the model call itself sends nothing after the
   * deltas: the response says the call failed.
   */
  ANSWER_WITHDRAWN = "ANSWER_WITHDRAWN",
}

/** Public surface of the LLMClient. Every `deps.llmClient` is typed with it; tests inject a FakeLLMClient that implements it. */
export interface ILLMClient {
  /** One model call. May return tool requests; never executes them. */
  complete(args: {
    request: IModelRequest;
    meta: ILLMClientCallMeta;
    tools?: IToolDef[];
    hooks?: Pick<ILLMClientHooks, "onEvent">;
    /** Aborts the provider call; the caller's deadline, next to the client's own timeout. */
    abortSignal?: AbortSignal;
  }): Promise<IModelResult>;

  /** The agent loop; pauses and stops through the hooks. */
  run(args: {
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
  }): Promise<IRunOutcome>;

  /** Text → vectors with an embedding model. */
  embed(args: {
    modelId: string;
    texts: string[];
    meta: ILLMClientCallMeta;
  }): Promise<number[][]>;

  /** Providers with credentials configured. */
  readonly providers: EModelProvider[];
}
