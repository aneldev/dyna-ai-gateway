import {dynaError} from "dyna-error";

import {
  IToolDef,
  IToolErrorReport,
  IUserContext,
} from "../../contracts";

import {
  TOOL_FAILURE_TEXT,
  asDynaError,
  formatToolError,
} from "./formatToolError";
import {
  IToolCallContext,
  IToolRegistry,
  IToolRegistryConfig,
  TOnToolErrorHandler,
} from "./types";

/** When `IToolRegistryConfig.toolTimeoutMs` is not set. */
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
/** When `IToolRegistryConfig.maxOutputChars` is not set. */
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;
/** Sentinel of the timeout race; a tool cannot return it. */
const TIMED_OUT: unique symbol = Symbol("timed-out");
/** Sentinel of the abort race; a tool cannot return it. */
const ABORTED: unique symbol = Symbol("aborted");

/**
 * ToolRegistry -- the fixed catalog of the gateway's tools and the one place a tool runs
 *
 * # About
 *
 * > Every tool the gateway knows, and the only door through which one executes.
 *
 * Holds the `IToolDef`s of the config and runs a tool on the model's behalf: input validated against the
 * tool's schema, the run under a timeout, the output under a size cap, so every tool, registry or per-call,
 * goes through the same pipeline (D60, D66).
 *
 * - Fixed at construction: nothing is added or removed later (D48).
 * - Executes only tools the run was offered; a name outside them is refused.
 * - Turns a tool's failure into an error the model can read, never into a crashed run: a `dynaError` keeps its `code`,
 *   `status` and `userMessage`; anything else is wrapped so the model reads a generic text, never the raw message.
 *
 * Sits under `ToolPolicy`, which decides what the model is offered and what needs approval; the agent
 * loop of the `LLMClient` calls back into it through the run hooks to execute.
 *
 * # Who needs it
 *
 * `createRunHooks` (execute), `prepareCall` and `AIProfileStore` (list, to resolve and validate tools),
 * `splitRunTools` (get, to rebuild the tools of a paused run).
 *
 * # What needs
 *
 * `IToolRegistryConfig`: the tools, the default timeout and the default output cap.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Any place that needs a tool by name or the whole catalog; executing a tool from the agent loop.
 *
 * ## When shouldn't use it
 *
 * Deciding which tools a call gets or whether a call needs approval: that is `ToolPolicy`.
 *
 * # Pitfalls
 *
 * The `abortSignal` a tool receives is advisory: a tool that ignores it keeps running after the 504 was reported or the
 * call was aborted, and its late result is dropped. An abort never undoes what a tool already did.
 *
 * See docs/architecture "Decisions.md" § ToolRegistry.
 */
export class ToolRegistry implements IToolRegistry {
  private readonly tools = new Map<string, IToolDef>();
  private readonly toolTimeoutMs: number;
  private readonly maxOutputChars: number;
  private readonly onToolError?: TOnToolErrorHandler;

  /**
   * constructor -- registers the tools of the config, once and for all
   *
   * # About
   *
   * > The catalog is sealed here (D48).
   *
   * # Pitfalls
   *
   * Throws a 400 on a duplicate tool name.
   */
  constructor(config: IToolRegistryConfig) {
    this.toolTimeoutMs = config.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    this.maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    this.onToolError = config.onToolError;
    (config.tools ?? []).forEach(tool => {
      if (this.tools.has(tool.name)) {
        throw dynaError({
          code: 5372567786217,
          status: 400,
          message: `ToolRegistry: a tool named [${tool.name}] is already registered`,
          data: {name: tool.name},
        });
      }
      this.tools.set(tool.name, tool);
    });
  }

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
  public get(
    {name}: {name: string},
  ): IToolDef {
    const tool = this.tools.get(name);
    if (!tool) {
      throw dynaError({
        code: 5372567786229,
        status: 404,
        message: `ToolRegistry: unknown tool [${name}]`,
        data: {name},
      });
    }
    return tool;
  }

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
  public list(): IToolDef[] {
    return [...this.tools.values()];
  }

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
  public async execute(
    {
      name,
      input,
      userContext,
      threadId,
      tools,
      abortSignal,
      callContext,
    }: {
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
    },
  ): Promise<unknown> {
    const startedAt = Date.now();
    // The input as the report shows it: parsed once the schema accepted it, raw while the schema is the failure
    let reportedInput = input;
    try {
      const tool = tools
        ? this.getOffered({
          name,
          tools,
        })
        : this.get({name});
      const parsed = tool.inputSchema.safeParse(input);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const field = first?.path.map(String).join(".");
        throw dynaError({
          code: 5372567786241,
          status: 400,
          message: `ToolRegistry: invalid input for tool [${name}]: ${first?.message ?? "unknown"}`,
          userMessage: `Invalid input for tool [${name}]${field ? ` at [${field}]` : ""}: ${first?.message ?? "unknown"}. Fix the input and call it again.`,
          data: {
            name,
            field,
            input,
          },
        });
      }
      reportedInput = parsed.data;
      let output: unknown;
      try {
        output = await this.runWithTimeout({
          tool,
          input: parsed.data,
          userContext,
          threadId,
          abortSignal,
        });
      }
      catch (error) {
        // The caller's abort is not a failure of the tool: its reason ends the run (D90)
        if (abortSignal?.aborted) throw error;
        throw this.normalizeFailure({
          tool,
          error,
        });
      }
      this.assertOutputSize({
        tool,
        output,
      });
      return output;
    }
    catch (error) {
      if (callContext && !abortSignal?.aborted) {
        this.reportFailure({
          name,
          input: reportedInput,
          userContext,
          threadId,
          callContext,
          error,
          startedAt,
        });
      }
      throw error;
    }
  }

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
  public reportFailure(
    {
      name,
      input,
      userContext,
      threadId,
      callContext,
      error,
      startedAt,
    }: {
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
    },
  ): void {
    if (!this.onToolError) return;
    const report: IToolErrorReport = {
      tenantId: userContext.tenantId,
      userContext,
      threadId,
      ...callContext.runId === undefined ? {} : {runId: callContext.runId},
      stepIndex: callContext.stepIndex,
      callId: callContext.callId,
      toolName: name,
      input,
      error,
      modelText: formatToolError(error),
      durationMs: Date.now() - startedAt,
      at: new Date(),
    };
    const logHandlerFailure = (handlerError: unknown): void => console.error(`Internal error 5376189327034: ToolRegistry: the onToolError handler failed for tool [${name}]`, handlerError);
    try {
      Promise.resolve(this.onToolError(report)).catch(logHandlerFailure);
    }
    catch (handlerError) {
      logHandlerFailure(handlerError);
    }
  }

  /** The tool among the offered ones; a name outside them is a 403, logged. */
  private getOffered(
    {
      name,
      tools,
    }: {
      name: string;
      tools: IToolDef[];
    },
  ): IToolDef {
    const tool = tools.find(candidate => candidate.name === name);
    if (tool) return tool;
    console.error(`Internal error 5375169186882: ToolRegistry: the model called tool [${name}], which was not offered to this run`);
    throw dynaError({
      code: 5375169186882,
      status: 403,
      message: `ToolRegistry: tool [${name}] is not available in this run`,
      userMessage: `Tool [${name}] is not available in this run. Use one of the tools offered, or answer without it.`,
      data: {
        name,
        offered: tools.map(candidate => candidate.name),
      },
    });
  }

  /**
   * Races the tool against its timeout and against the call's abort.
   * Past the timeout: aborts the tool's signal, throws a 504, logged.
   * On the call's abort: the tool's signal (merged) is already aborted; throws the signal's reason, not logged.
   */
  private async runWithTimeout(
    {
      tool,
      input,
      userContext,
      threadId,
      abortSignal,
    }: {
      tool: IToolDef;
      input: unknown;
      userContext: IUserContext;
      threadId: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<unknown> {
    if (abortSignal?.aborted) throw abortSignal.reason;
    const timeoutMs = tool.timeoutMs ?? this.toolTimeoutMs;
    const controller = new AbortController();
    const toolSignal = abortSignal
      ? AbortSignal.any([abortSignal, controller.signal])
      : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>(resolve => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<typeof ABORTED>(resolve => {
      if (!abortSignal) return;
      onAbort = (): void => resolve(ABORTED);
      abortSignal.addEventListener("abort", onAbort, {once: true});
    });
    try {
      const output = await Promise.race([
        tool.execute({
          input,
          userContext,
          threadId,
          abortSignal: toolSignal,
        }),
        timeout,
        aborted,
      ]);
      if (output === ABORTED) throw abortSignal?.reason;
      if (output !== TIMED_OUT) return output;
      controller.abort();
      console.error(`Internal error 5374403782185: ToolRegistry: tool [${tool.name}] gave no answer within ${timeoutMs} ms`);
      throw dynaError({
        code: 5374403782185,
        status: 504,
        message: `ToolRegistry: tool [${tool.name}] did not answer within ${timeoutMs} ms`,
        userMessage: `Tool [${tool.name}] did not answer within ${timeoutMs} ms. Try a narrower request, or answer without it.`,
        data: {
          name: tool.name,
          timeoutMs,
        },
      });
    }
    finally {
      clearTimeout(timer);
      if (abortSignal && onAbort) abortSignal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * The error of a failed run of the tool, as the loop will store it.
   * A `dynaError` with a `userMessage` passes through unlogged: an expected outcome the tool chose to report (the 504 is one, logged where raised).
   * Anything else is a bug or an outage, logged: a `dynaError` without `userMessage` passes through (its code and status still tell the model
   * the class), a foreign error is wrapped in a 500 whose `userMessage` is `TOOL_FAILURE_TEXT`, `parentError` the original.
   */
  private normalizeFailure(
    {
      tool,
      error,
    }: {
      tool: IToolDef;
      error: unknown;
    },
  ): unknown {
    const dyna = asDynaError(error);
    if (dyna?.userMessage !== undefined) return error;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Internal error 5376189327022: ToolRegistry: tool [${tool.name}] failed: ${reason}`, error);
    if (dyna) return error;
    return dynaError({
      code: 5376189327022,
      status: 500,
      message: `ToolRegistry: tool [${tool.name}] failed: ${reason}`,
      userMessage: TOOL_FAILURE_TEXT,
      parentError: error,
      data: {name: tool.name},
    });
  }

  /** A 413, logged, when the output as JSON text exceeds the tool's cap. */
  private assertOutputSize(
    {
      tool,
      output,
    }: {
      tool: IToolDef;
      output: unknown;
    },
  ): void {
    const maxOutputChars = tool.maxOutputChars ?? this.maxOutputChars;
    const size = JSON.stringify(output)?.length ?? 0;
    if (size <= maxOutputChars) return;
    console.error(`Internal error 5374403782197: ToolRegistry: tool [${tool.name}] returned ${size} chars, more than the ${maxOutputChars} allowed`);
    throw dynaError({
      code: 5374403782197,
      status: 413,
      message: `ToolRegistry: tool [${tool.name}] returned ${size} chars, more than the ${maxOutputChars} allowed; narrow the request`,
      userMessage: `Tool [${tool.name}] returned too much data (${size} characters, the limit is ${maxOutputChars}). Narrow the request.`,
      data: {
        name: tool.name,
        size,
        maxOutputChars,
      },
    });
  }
}
