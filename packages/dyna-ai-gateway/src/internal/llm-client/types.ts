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
  /** Resolves a `modelId` to its provider and caps, and prices a call for the usage report and the trace. */
  modelRegistry: IModelRegistry;
  /** Asked before every call and told after it, including helper calls; the app's adapter sits behind it. */
  usageGuard: IUsageGuard;
  /** Every call is recorded here; the gateway annotates the main one. */
  trace: ITrace;
}

/** Who and why, for every LLMClient call. The UsageGuard and the Trace need it; the LLMClient stores nothing. */
export interface ILLMClientCallMeta {
  /** The tenant that pays and owns the trace entry. */
  tenantId: string;
  /** Omitted for system jobs (e.g. KB ingestion). */
  userId?: string;
  /** The profile the call runs on. Omitted for system jobs (e.g. KB ingestion). */
  profileId?: string;
  /** The thread of the call; omitted for a call outside a thread (an embedding, a KB ingestion). */
  threadId?: string;
  /** The run the call is a step of; omitted outside a run. */
  runId?: string;
  /** What the call is for: the answer, a run step, a judge, a rewrite, a memory update, an embedding. */
  kind: ETraceKind;
}

/**
 * How to reach one provider.
 *
 * `apiKey` is the provider's key; for `EModelProvider.BEDROCK` it is a Bedrock API key (bearer token), not an IAM key pair.
 */
export interface IProviderCredentials {
  /** The provider's API key; for Bedrock the bearer token. */
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
  /** The registry id of the model to call. */
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
  /** The transcript the model continues: the history, the user turn, the tool turns of a run. */
  messages: IMessage[];
  /** Zod schema for structured output; omitted = free text. */
  outputSchema?: ZodType;
  /** The output cap of the call: the profile's, set by the ContextAssembler; the `output` of the usage check. */
  maxOutputTokens: number;
  /**
   * Sampling temperature, in the provider's range (OpenAI 0–2, Anthropic 0–1); omit for the provider default.
   * Only on a model whose `caps.temperature` is true: the client refuses it otherwise (400, D82).
   */
  temperature?: number;
}

/** One block of the system prompt; the ContextAssembler splits CHAT_MAIN into a stable and a per-call block. */
export interface ISystemBlock {
  /** The block's text, as rendered from the template. */
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
  /** Who speaks: the user, the model, or a tool answering the model. */
  role: EMessageRole;
  /** The content, in order; which kinds a role may carry, `toSdkMessages` decides. */
  parts: TMessagePart[];
}

/** Roles the LLMClient understands. */
export enum EMessageRole {
  /** The user: text and inlined files. */
  USER = "USER",
  /** The model: text and tool calls. */
  ASSISTANT = "ASSISTANT",
  /** A tool's results, one message per step. */
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
  /** The discriminator of the part. */
  kind: EPartKind.INLINE_FILE;
  /** The media type the provider reads the bytes as. */
  mime: string;
  /** Empty in a trace entry and in a stored run: the bytes stay in the FileStore only, a resume loads them again by `fileId` (D108). */
  bytes: Uint8Array;
  /** The file name shown to the model. */
  name: string;
  /** Id of the stored file the bytes come from. */
  fileId: string;
  /** Number of bytes of the file; kept where `bytes` is emptied. */
  size: number;
}

/** What one model call produced. */
export interface IModelResult {
  /** The model that answered. */
  modelId: string;
  /** Free text, when any. */
  text: string;
  /** Parsed structured output, when outputSchema was given. */
  structured?: unknown;
  /** Tool requests made in this call (complete: unexecuted; run: executed with results in messages). */
  toolCalls: IToolCallPart[];
  /** Why the model stopped. */
  finishReason: EFinishReason;
  /** What the provider reported for this call. */
  usage: IUsage;
  /** Wall time. */
  latencyMs: number;
  /** Trace entry written by the LLMClient; the gateway annotates it. */
  traceId: string;
}

/** Why the model stopped. */
export enum EFinishReason {
  /** The model finished its answer (also the SDK's "other"). */
  STOP = "STOP",
  /** The output cap was hit; the answer may be incomplete (`output_truncated`). Also a run the limits stopped. */
  LENGTH = "LENGTH",
  /** The model stopped to ask for tools. */
  TOOL_CALLS = "TOOL_CALLS",
  /** The provider's content filter cut the answer. */
  CONTENT_FILTER = "CONTENT_FILTER",
  /** The provider reported an error as the finish. */
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
  /** The tool call as the model made it. */
  call: IToolCallPart;
  /** The policy's text for a rejection of this call; omitted = the default. */
  rejectionText?: string;
  /** The policy's code for why this call waits for a human; omitted = none. */
  reasonCode?: string;
}

/** Outcome of a run: finished, paused for a human, or aborted by the caller's signal (D90). */
export interface IRunOutcome {
  /** How the run ended: DONE, PAUSED for a human, or ABORTED by the caller's signal. */
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
  /** The model answered, the limits stopped it, or a terminal tool ended it: `result` is set. */
  DONE = "DONE",
  /** Tool calls wait for a human: `pendingCalls` is set, the gateway stores the pause. */
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
  /** What happened. */
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
  /** The step of the run (0-based) the event belongs to; 0 for an `ask`. */
  stepIndex: number;
}

/** Event kinds a client can render as progress. */
export enum ELLMClientEventKind {
  /** A chunk of the model's text, in `text`. */
  TEXT_DELTA = "TEXT_DELTA",
  /**
   * The model asked for a tool call; its TOOL_RESULT follows once the tool answered. A call the abort cut (D90) gets no
   * TOOL_RESULT event: the response says the call failed, and the thread holds the error result.
   */
  TOOL_REQUEST = "TOOL_REQUEST",
  /** A tool answered (or was denied): the call in `toolCall`, what the model reads in `toolOutput`. */
  TOOL_RESULT = "TOOL_RESULT",
  /** The run waits for a human: the pending calls in `toolCalls`, or none when the answer waits for a review (D99). */
  RUN_PAUSED = "RUN_PAUSED",
  /**
   * A tool with `endsRun` ran (D86): sent once, after the STEP_END of its step and before the final step that phrases the answer.
   * A client can show "handed over" before the closing text streams.
   */
  RUN_ENDED_BY_TOOL = "RUN_ENDED_BY_TOOL",
  /** A step of the run is complete: its model call and its tools. */
  STEP_END = "STEP_END",
  /** The call is complete; the response follows. Sent once per call, after the last step. */
  DONE = "DONE",
  /** The call failed; the response says why. */
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
  complete(args: {
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
  }): Promise<IModelResult>;

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
  }): Promise<IRunOutcome>;

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
  embed(args: {
    modelId: string;
    texts: string[];
    meta: ILLMClientCallMeta;
  }): Promise<number[][]>;

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
  readonly providers: EModelProvider[];
}
