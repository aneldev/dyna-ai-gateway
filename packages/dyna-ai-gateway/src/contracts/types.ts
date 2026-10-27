import {ZodType} from "zod";

/** Who is asking. Supplied by the business service on every gateway call; never stored by the gateway. */
export interface IUserContext {
  /** Tenant scope of this call. */
  tenantId: string;
  /** Acting user. */
  userId: string;
  /** Permission keys of the user; ToolPolicy filters tools against them. */
  permissions: string[];
  /** BCP-47, e.g. "de-AT"; injected into the system prompt. */
  locale: string;
  /** IANA zone, e.g. "Europe/Vienna". */
  timezone: string;
  /** "Now" as the app sees it; injected as today's date. */
  now: Date;
}

/** One message of a thread, from one side, made of typed parts. Stored by ThreadStore. */
export interface ITurn {
  /** Unique within the thread. */
  id: string;
  /** Who produced it. */
  role: ETurnRole;
  /** Ordered content. */
  parts: TTurnPart[];
  /** Tokens spent by this turn; assistant turns only. */
  usage?: IUsage;
  /** Model that produced it; assistant turns only. */
  modelId?: string;
  createdAt: Date;
}

/** Sides of a conversation. */
export enum ETurnRole {
  USER = "USER",
  ASSISTANT = "ASSISTANT",
  /** Tool results are stored as their own turn so the timeline is complete. */
  TOOL = "TOOL",
}

/** One piece of a turn. Discriminated by `kind`. */
export type TTurnPart =
  | ITextPart
  | IFilePart
  | IToolCallPart
  | IToolResultPart;

/** Kinds of turn parts. */
export enum EPartKind {
  TEXT = "TEXT",
  FILE = "FILE",
  TOOL_CALL = "TOOL_CALL",
  TOOL_RESULT = "TOOL_RESULT",
  /** Only in LLMClient messages: bytes inlined for the model. */
  INLINE_FILE = "INLINE_FILE",
}

/** Plain text. */
export interface ITextPart {
  kind: EPartKind.TEXT;
  text: string;
}

/** Reference to a stored file (image, PDF). Bytes live in FileStore. */
export interface IFilePart {
  kind: EPartKind.FILE;
  file: IFileRef;
}

/** The model asked for a tool. */
export interface IToolCallPart {
  kind: EPartKind.TOOL_CALL;
  /** Correlates with the result part. */
  callId: string;
  toolName: string;
  /** Validated input. */
  input: unknown;
}

/** What the tool returned (or the rejection of the human). */
export interface IToolResultPart {
  kind: EPartKind.TOOL_RESULT;
  callId: string;
  toolName: string;
  output: unknown;
  /** True when the human rejected the call; output holds the reason. */
  rejected?: boolean;
  /** True when the tool's `policy` refused the call (D87); output holds the text the model reads. Not counted as executed (D76). */
  denied?: boolean;
  /** True when the tool did not run or threw (refused, invalid input, timeout, error); output holds `{error}`. Not counted as executed (D76). */
  failed?: boolean;
  /**
   * The `code` of the error behind a failed call: the tool's own `dynaError` code, or the gateway's for a refusal, an invalid
   * input, a timeout, an oversized output or a wrapped foreign error.
   *
   * > Names the failure without parsing `output.error`, and matches `IToolErrorReport.error.code` of the same `callId`.
   *
   * Only with `failed: true`; absent when the error carried no code.
   */
  errorCode?: number;
  /**
   * True on the result of the call that ended the run (the tool's `endsRun`, D86); at most one per run.
   *
   * > A paused run keeps it in its messages, so a run that pauses in the step a tool ended it still ends after the resume.
   */
  endedRun?: boolean;
}

/** Pointer to a stored blob. Produced by FileStore. */
export interface IFileRef {
  id: string;
  tenantId: string;
  /**
   * Who uploaded the file. Part of where the file is stored, so that all files of a user can be deleted at once.
   * The gateway checks it: a question may carry only the calling user's own files, another user's pointer is a 400.
   */
  userId: string;
  /** MIME type, e.g. "image/png", "application/pdf". */
  mime: string;
  /** Bytes. */
  size: number;
  /** Original file name. */
  name: string;
}

/** Token accounting of one model call. */
export interface IUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from provider cache, when reported. */
  cachedInputTokens?: number;
}

/**
 * One tool as registered. Also what the LLMClient hands to the SDK.
 * TInput is inferred from inputSchema (use `defineTool`), so `execute` receives a typed input.
 */
/** Sent to the model as a tool's output when the human rejects the call and the tool's policy gave no `rejectionText` for it (D87); the human's reason is appended. */
export const DEFAULT_TOOL_REJECTION_TEXT = "The user declined this tool call. It was not executed and nothing happened. Do not call it again unless the user asks; tell the user it was not done and ask how to proceed.";

/** Sent to the model as a tool's output when the tool's `policy` denies the call (D87); the policy's reason is appended. */
export const DEFAULT_TOOL_DENIAL_TEXT = "The application's policy refused this tool call. It was not executed and nothing happened. Do not call it again with the same input; tell the user it was not done and ask how to proceed.";

/** What a tool's `policy` can say about one call (D87). */
export enum EToolCallVerdict {
  /** The call runs now, without a human. The same as a tool without `policy`. */
  ALLOW = "ALLOW",
  /**
   * The call is refused before it runs.
   *
   * > The model is told it was refused and why, so it can recover (correct the input, ask the user, do something else).
   *
   * The tool never executes; the result the model reads is `DEFAULT_TOOL_DENIAL_TEXT` plus the policy's `reason`. The other
   * calls of the same step still run, and the run goes on. A denied call counts as not executed for `requires` and never ends
   * the run.
   */
  DENY = "DENY",
  /**
   * The app's policy accepts the call, but a human must approve it before it runs.
   *
   * > The policy's job is done; the decision is now the user's, through the human gate.
   *
   * The run pauses with the call in a TOOL_APPROVAL envelope. APPROVE or EDIT executes it; REJECT sends the result's
   * `rejectionText` (or `DEFAULT_TOOL_REJECTION_TEXT`) with the human's reason to the model, and the tool never ran.
   */
  NEEDS_APPROVAL = "NEEDS_APPROVAL",
}

/**
 * The verdict of a tool's `policy` on one call (D87): allow it, deny it with a reason, or hand it to a human.
 *
 * Returned by `TToolCallPolicyHandler`, decided by `ToolPolicy.decide` and acted on by the agent loop.
 */
export type TToolCallPolicyResult =
  | {verdict: EToolCallVerdict.ALLOW}
  | {
    verdict: EToolCallVerdict.DENY;
    /** Why the call is refused, as the model reads it; appended to `DEFAULT_TOOL_DENIAL_TEXT`. Say what would be accepted. */
    reason: string;
  }
  | {
    verdict: EToolCallVerdict.NEEDS_APPROVAL;
    /**
     * Sent to the model as the tool's output when the human rejects this call; the human's reason is appended.
     *
     * > The model does not know what a rejection means for this tool; this text tells it what did not happen and how to go on.
     *
     * May depend on the input ("the refund of 800 EUR was declined").
     *
     * @default DEFAULT_TOOL_REJECTION_TEXT
     */
    rejectionText?: string;
    /**
     * Why this call waits for a human, as a code the app translates; carried by the pause as `IToolApprovalEnvelope.reasonCode`.
     *
     * > Tells the approval card why the call waits, in the user's language.
     *
     * The card renders what the call does from `toolCall.toolName` and its input; this says why it needs a human, when one tool
     * pauses for more than one reason. A key of the app's translations, not text: the app owns the card and its language. Never sent to the model.
     *
     * @example "amountOverLimit" - the refund of 500 waits because it is above the limit of 100
     * @example "newCustomer" - the same tool pauses a first refund of any amount
     */
    reasonCode?: string;
  };

/**
 * The tool's own policy on a call, evaluated by ToolPolicy.decide on the parsed input before the call runs (D87).
 * Declared through a method so it stays bivariant like `execute`: an `IToolDef<{amount: number}>` is still an `IToolDef`.
 */
export type TToolCallPolicyHandler<TInput> = {
  handler(args: {
    /** Validated input. */
    input: TInput;
    /** Who is calling. */
    userContext: IUserContext;
  }): TToolCallPolicyResult | Promise<TToolCallPolicyResult>;
}["handler"];

/**
 * The tool's own rule for ending the run, evaluated by ToolPolicy.endsRun after the tool executed (D86).
 * Declared through a method so it stays bivariant like `execute`: an `IToolDef<{amount: number}, {status: string}>` is still an `IToolDef`.
 */
export type TToolEndsRunHandler<TInput, TOutput> = {
  handler(args: {
    /** Validated input of this call. */
    input: TInput;
    /** What `execute` returned for this call. */
    output: TOutput;
    /** Who is calling. */
    userContext: IUserContext;
  }): boolean | Promise<boolean>;
}["handler"];

/**
 * The tool's own rule for being offered in a step, evaluated by ToolPolicy.narrowForStep before every model call (D89).
 *
 * Sync: it runs on every step, on data the loop already has; a look-up belongs in `execute` or in a `policy` predicate.
 */
export type TToolVisibleWhenHandler = (args: {
  /** 0 for the first model call of the run. */
  stepIndex: number;
  /** Names of the tools executed so far in this run: a result that was neither rejected nor failed (D76). */
  executed: string[];
}) => boolean;

export interface IToolDef<TInput = unknown, TOutput = unknown> {
  /** Unique, snake_case; the model refers to it by this name. */
  name: string;
  /** What the model reads to decide when to call it. Precise text matters. */
  description: string;
  /** Zod schema of the input; ToolRegistry parses the model's input with it before execute. */
  inputSchema: ZodType<TInput>;
  /** Free tags for policy filtering, e.g. "billing". */
  tags: string[];
  /**
   * What happens to a call of this tool before it runs (D87): it runs, it is refused, or a human must approve it.
   *
   * > One rule per tool, decided per call on the parsed input, outside the tool's own code.
   *
   * A verdict applies to every call: `NEEDS_APPROVAL` (a refund, an email), `DENY` (a kill switch for a tool that stays
   * registered), `ALLOW` (the same as omitting the field). A predicate decides per call on the parsed input and the user
   * context, sync or async (it may look something up), and returns a `TToolCallPolicyResult`. The rules apply in this order:
   * an input the schema rejects never reaches the policy (`execute` reports it to the model); then this field; then the
   * profile's `approvals` as the floor, which turns an `ALLOW` into `NEEDS_APPROVAL`. `DENY` wins over everything: a human is
   * never asked to approve a call that would be refused. In a parallel step a predicate decides each call after the earlier
   * calls of the step ran (D112), so it may read state they change. An input a human edited on approval is decided again (D109): a
   * `DENY` refuses it, a `NEEDS_APPROVAL` runs it (the human approved that input).
   *
   * @example EToolCallVerdict.NEEDS_APPROVAL - every refund waits for a human
   * @example ({input}) => input.amount > 500 ? {verdict: EToolCallVerdict.NEEDS_APPROVAL, rejectionText: `The refund of ${input.amount} was declined.`} : {verdict: EToolCallVerdict.ALLOW} - small refunds run, large ones wait
   * @example async ({input}) => (await charges.get(input.chargeId)) ? {verdict: EToolCallVerdict.ALLOW} : {verdict: EToolCallVerdict.DENY, reason: "There is no charge with this id."} - refuses what cannot work
   *
   * @default EToolCallVerdict.ALLOW
   */
  policy?: EToolCallVerdict | TToolCallPolicyHandler<TInput>;
  /**
   * Whether a successful call of this tool ends the run (D86). Omitted = never.
   *
   * > For tools that are terminal by nature: a hand-over to a human agent, an escalation, a placed order.
   *
   * `true`: every call. A predicate: per call, on the parsed input and the tool's output (ended only when the hand-over
   * was accepted). Evaluated after the tool returned, so a call that failed, timed out, was refused or was rejected by the
   * human never ends the run. The other calls of the same step still run; then the model gets one last step without tools to
   * phrase the answer, and the response names the tool in `endedByTool`.
   *
   * With a predicate, write `execute` before `endsRun` in the tool literal: `output` is typed from the return type of
   * `execute`, and TypeScript infers the two functions in the order they are written, so a predicate written first sees `unknown`.
   *
   * @example true - `handover_to_agent`: once a human has the case the assistant has nothing more to do
   * @example ({output}) => output.status === "accepted" - ends only when the hand-over went through
   *
   * @default false
   */
  endsRun?: boolean | TToolEndsRunHandler<TInput, TOutput>;
  /**
   * In which steps of a run the model is offered this tool (D89). Omitted = every step.
   *
   * > For a tool that belongs to one moment of the run: a classifier of the request on the first step, a report only after
   * > the data was fetched.
   *
   * Made for agents with many tools: a classifier offered on the first step turns the request into a stated intent, so the
   * model picks the next tools from that result instead of guessing from the prompt. Decided before every model call, on the step index and the tools executed so far in this run. A tool hidden for a step
   * is not in the model's tool list and cannot be called by name in it (D72). `requires` of `IToolPolicyConfig` is the same
   * rule as config; a tool must pass both. Visibility is not a forced call: the model may still answer without calling it.
   *
   * @example ({stepIndex}) => stepIndex === 0 - `classify_intent` is offered only on the first step
   * @example ({executed}) => executed.includes("lookup_order") - offered once the order was looked up, like `requires: {refund: ["lookup_order"]}`
   */
  visibleWhen?: TToolVisibleWhenHandler;
  /** Overrides IToolRegistryConfig.toolTimeoutMs for this tool (D60). */
  timeoutMs?: number;
  /** Overrides IToolRegistryConfig.maxOutputChars for this tool (D60). */
  maxOutputChars?: number;
  /**
   * Executes the tool. Called only by ToolRegistry.execute, under the tool's timeout: a tool that has not answered by then
   * fails with a 504 the model reads as a tool error, and `abortSignal` is aborted so the tool can stop its own work (D60).
   * The same signal is aborted when the call is stopped by its caller (`IGatewayAskInput.abortSignal` / `timeoutMs`); the gateway
   * stops waiting then, so a tool that ignores the signal keeps running for nothing, and an abort never undoes what it did.
   *
   * **To tell the model what went wrong, throw a `dynaError` with a `userMessage`.** A thrown error never ends the run: it
   * becomes the tool's result, which the model reads to recover (ask the user for the missing data, try another way, answer
   * without the tool). The model reads one line, `code: <code>, status: <status>, userMessage: <userMessage>`, so:
   *
   * - `userMessage` must be **safe to show to the end user** — no hosts, ids of internal systems, stack or SQL — and say
   *   how to proceed: "No order with id 4711; ask the customer for the number on the invoice", not "Query failed".
   * - `status` tells the model the class of the failure (a 404 is not a 503); `code` is the locator an end user can quote
   *   to support, and is stamped on the stored result as `IToolResultPart.errorCode`.
   * - `canRetry: false` adds "Do not retry this call." for a failure that will repeat with the same input.
   * - `message` and `data` are for the developer only: they go to the server log and to `IToolRegistryConfig.onToolError`,
   *   never to the model.
   *
   * Any other error — a plain `Error`, a `dynaError` without `userMessage` — is treated as a bug of the tool or an outage of
   * what it calls: the model reads a generic text that says the input was not the cause (status 500, the gateway's code), the
   * error itself is logged and reported through `onToolError`. So a tool that lets its HTTP client's error through leaks
   * nothing; a tool that wants the model to recover must catch and rethrow with a `userMessage`.
   */
  execute(args: {
    /** Validated input. */
    input: TInput;
    /** Who is calling. */
    userContext: IUserContext;
    /** Thread of the call. */
    threadId: string;
    /**
     * Aborted at the tool's timeout or when the call is aborted.
     * Pass it to fetch / the SDK of the service the tool calls.
     */
    abortSignal: AbortSignal;
  }): Promise<TOutput>;
}

/**
 * Everything the gateway knows about one failed tool call: the tool threw, timed out, returned too much, got an input its
 * schema rejected, or was not offered to the run. Written for the developer, so nothing is held back; the model reads
 * `modelText` only.
 *
 * Handed to `IToolRegistryConfig.onToolError` by `ToolRegistry.execute`, once per failed call, right before the failure
 * becomes the tool's result. Never for a call the caller aborted (D90): that is not a failure of the tool.
 */
export interface IToolErrorReport {
  /** Tenant of the call. */
  tenantId: string;
  /** Who was calling. */
  userContext: IUserContext;
  /** Thread of the call. */
  threadId: string;
  /** The run, when it is already stored: on a resume. A fresh run is stored when it pauses, so during its loop there is none. */
  runId?: string;
  /** Step of the run (0-based) in which the model asked for the call. */
  stepIndex: number;
  /**
   * The model's id of the call.
   *
   * > The key into the rest of the record: the thread's `IToolCallPart` and `IToolResultPart` carry it, and so does the
   * > request of the next step's trace entry (`ITraceEntry.request.messages`).
   */
  callId: string;
  /** The tool the model called, as it named it. */
  toolName: string;
  /** The model's input: parsed when the tool's schema accepted it, raw when the rejected input is the failure. */
  input: unknown;
  /** The error as it was thrown, untouched: the tool's own, or the gateway's `dynaError` (`code`, `status`, `data`). */
  error: unknown;
  /** The text the model reads as the result of the call. */
  modelText: string;
  /** Time from the start of `execute` to the failure. */
  durationMs: number;
  /** When the failure was recorded. */
  at: Date;
}

/** One retrievable KB unit. Produced by MdChunker, stored by VectorStore. */
export interface IChunk {
  id: string;
  docId: string;
  bookId: string;
  /** The library the book belongs to (a tenant has libraries, a library has books); copied from the document. The usual search filter. */
  libraryId: string;
  /** "Refunds > Paid invoices > Time limits" — prefixed into the text at embed time. */
  headingPath: string;
  text: string;
  /** Position inside the document. */
  order: number;
  tokens: number;
  tags: string[];
  /** BCP-47. */
  language: string;
}

/** How the text of an answer is formatted. The caller knows its renderer (chat page, SMS, voice), so it decides per call. */
export enum EOutputFormat {
  /** GitHub-flavoured Markdown; structure only when the content calls for it. The default. */
  MARKDOWN = "MARKDOWN",
  /** No markup at all, for SMS, voice or a plain-text field. */
  PLAIN = "PLAIN",
}

/** Common result of any check (guardrails, usage, assembler). */
export interface IIssue {
  /** The Guardrails rule that reported it; stamped by the Guardrails, also on `rule_error`. Absent on other issues (usage, assembler). */
  ruleName?: string;
  /** Machine code, e.g. "sum_mismatch". */
  code: string;
  /**
   * Dev/Tech message: what happened, in English, ids in brackets, for the server log and the developer.
   *
   * > Never shown to the end user; `userMessage` is the text for them.
   */
  message: string;
  severity: EIssueSeverity;
  /** Field path when the issue concerns one field. */
  field?: string;
  /**
   * Text for the end user, when the issue has one.
   *
   * > The application's own words, already in the user's language.
   *
   * Set on `usage_denied` from the usage adapter's `denyUserMessage`; a host shows it as it is and never shows `message`.
   */
  userMessage?: string;
  /**
   * Machine-readable details of the issue, when it has some.
   *
   * @example {denyCode: "plan_exhausted"} - the `denyCode` the usage adapter answered a `usage_denied` with
   */
  data?: Record<string, unknown>;
}

/** How bad an issue is. */
export enum EIssueSeverity {
  INFO = "INFO",
  WARNING = "WARNING",
  ERROR = "ERROR",
}

/**
 * One read of a list, paged the way the Vercel chat client pages (D37): a limit and one cursor, newest first.
 *
 * Taken by every list method of the gateway (`ThreadStore.listThreads`, `Trace.query`, `PromptTemplateStore.listVersions`).
 * The cursor is the identity of an item: its id for threads and trace entries, its version for prompt templates.
 */
export interface IPageArgs<TCursor = string> {
  /**
   * How many items, 1–200.
   *
   * @example 20 - one screen of a sidebar or an admin table
   */
  limit: number;
  /**
   * An item: return the items newer than it.
   *
   * > Scrolling up. Null when not used; never together with `endingBefore`.
   */
  startingAfter: TCursor | null;
  /**
   * An item: return the items older than it.
   *
   * > Scrolling down, the next page. Null when not used; never together with `startingAfter`.
   */
  endingBefore: TCursor | null;
}

/**
 * One read's answer: the items of the page and whether the list goes on.
 *
 * Returned by every list method that takes `IPageArgs`.
 */
export interface IPage<TItem> {
  items: TItem[];
  /** True when there are more items in the direction of the read. */
  hasMore: boolean;
}

/**
 * Which threads a bulk operation covers: every thread of the tenant (and of the user when one is named), or the listed ids.
 *
 * `AIGateway.delete` takes it and so does the bulk `delete` of the thread, run and trace repositories.
 */
export type TThreadIds = "all" | string[];
