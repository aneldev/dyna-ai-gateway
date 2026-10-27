import {
  IToolDef,
  IToolErrorReport,
  IUserContext,
} from "../../contracts";

/**
 * Called once per failed tool call with everything the gateway knows about it.
 *
 * The handler of `IToolRegistryConfig.onToolError`; the return value is ignored and a thrown error is logged, never felt by the run.
 */
export type TOnToolErrorHandler = (report: IToolErrorReport) => void | Promise<void>;

/**
 * Where a tool call sits in its run: what `IToolErrorReport` needs beyond the tool and the thread.
 *
 * Passed by `createRunHooks` to `ToolRegistry.execute` and `reportFailure`; a direct call outside a run has none.
 */
export interface IToolCallContext {
  /** The model's id of the call. */
  callId: string;
  /** Step of the run (0-based) that asked for the call. */
  stepIndex: number;
  /** The run, when it is already stored (on a resume). */
  runId?: string;
}

/** Configuration of the ToolRegistry. Lands in IAIGatewayConfig.toolRegistry. */
export interface IToolRegistryConfig {
  /** Every tool of the gateway, fixed at construction; nothing is added or removed later (D48). */
  tools?: IToolDef[];
  /** Time a tool may take before it fails with a 504; a tool's own timeoutMs wins (D60). Default 30_000. */
  toolTimeoutMs?: number;
  /** Largest output a tool may return, measured as JSON text; a larger one fails with a 413; a tool's own maxOutputChars wins (D60). Default 50_000. */
  maxOutputChars?: number;
  /**
   * The developer's channel for failed tool calls: the tool threw, timed out, returned too much, got an input its schema
   * rejected, or was not offered to the run.
   *
   * > One place to log, count or alert on tool failures, instead of a callback on every tool.
   *
   * Called for every failed call, fire-and-forget: the run never waits for it, and a handler that throws is logged and
   * ignored. With or without a handler, every failure is logged on the server, and the model reads only the safe text
   * (`IToolErrorReport.modelText`). A 400 (the model's input missed the schema) says the tool's description or schema is
   * unclear to the model; a 504 that the tool's timeout is short for what it does.
   *
   * @example report => logger.warn({tool: report.toolName, code: (report.error as {code?: number}).code, callId: report.callId}) - one log line per failure, findable by the call id in the thread
   */
  onToolError?: TOnToolErrorHandler;
}

/**
 * Every tool the gateway knows, and the only door through which one executes.
 *
 * Implemented by `ToolRegistry`; the type of `IAIGatewayDeps.toolRegistry`, so a host may pass its own in `overrides`.
 */
export interface IToolRegistry {
  /**
   * get -- one tool definition by name
   *
   * # About
   *
   * > The catalog lookup; a 404 when the name is unknown.
   *
   * # Who needs it
   *
   * `splitRunTools`, to rebuild the registry tools of a paused run from their stored names.
   */
  get(args: {name: string}): IToolDef;

  /**
   * list -- every tool definition, in config order
   *
   * # About
   *
   * > The whole catalog, unfiltered.
   *
   * # Who needs it
   *
   * `prepareCall`, which hands it to `ToolPolicy.resolve`; `AIProfileStore`, to validate a profile's tool names.
   */
  list(): IToolDef[];

  /**
   * execute -- runs one tool for the model, through the one pipeline
   *
   * # About
   *
   * > Validate, run under the timeout, cap the output.
   *
   * - A 403 when the name is not among the offered `tools`.
   * - A 400 naming the field when the input fails the tool's schema.
   * - A 504 when the tool gives no answer within its timeout; its `abortSignal` is aborted (D60).
   * - A 413 when the output, as JSON text, exceeds the tool's cap (D60).
   * - The call's `abortSignal`, when given, is merged into the tool's: once the input is validated, an aborted call aborts the
   *   tool and `execute` rejects with the signal's reason at once, not with a 504 and not logged (the caller asked for it).
   *
   * Every failure is reported to `IToolRegistryConfig.onToolError` with the whole picture (`IToolErrorReport`) when the call
   * comes with its `callContext`; a direct call outside a run is not reported. The abort is never reported.
   *
   * Runs inside the agent loop, after `ToolPolicy.decide` said ALLOW (or after the human approved).
   *
   * # Who needs it
   *
   * `createRunHooks`, as the loop's `executeTool` hook.
   *
   * # Pitfalls
   *
   * The thrown errors are logged on the server and fed to the model as the tool's result; they never end the run. The one
   * exception is the call's abort: its reason is thrown as it is and ends the run (D90).
   * `input` and the result are `unknown` on purpose: the tool is chosen by name at runtime and the input comes from
   * the model; the types live on `IToolDef<TInput, TOutput>`.
   */
  execute(args: {
    name: string;
    /** As the model sent it; validated here against the tool's schema. */
    input: unknown;
    userContext: IUserContext;
    threadId: string;
    /**
     * The tools offered to this run, the call's additional ones among them (D66).
     *
     * > When given, the only tools the call may run; a name outside them is a 403.
     *
     * Omit only for direct use outside a run: the registry is then the catalog.
     */
    tools?: IToolDef[];
    /** The call's signal: aborted when the caller stops the call or its deadline passes. */
    abortSignal?: AbortSignal;
    /** The call's place in its run, for the failure report; omitted for a direct call outside a run (not reported). */
    callContext?: IToolCallContext;
  }): Promise<unknown>;

  /**
   * reportFailure -- hands a failed tool call to `IToolRegistryConfig.onToolError`
   *
   * # About
   *
   * > The developer's channel, fed from the one place that knows the whole call.
   *
   * Builds the `IToolErrorReport` (the text the model reads included, `formatToolError`) and delivers it without waiting:
   * the run never waits for the handler, and a handler that throws or rejects is logged (`5376189327034`) and ignored.
   * Nothing happens without a handler.
   *
   * # Who needs it
   *
   * `execute`, for every failure it throws; `createRunHooks`, for the refusal `ToolPolicy.assertOfferedInStep` throws
   * before the registry is reached (D88) — the same report for the model's every failed call.
   */
  reportFailure(args: {
    name: string;
    /** Parsed when the schema accepted it, raw otherwise. */
    input: unknown;
    userContext: IUserContext;
    threadId: string;
    callContext: IToolCallContext;
    /** As thrown. */
    error: unknown;
    /** `Date.now()` when the call started; the report's `durationMs` is measured from it. */
    startedAt: number;
  }): void;
}
