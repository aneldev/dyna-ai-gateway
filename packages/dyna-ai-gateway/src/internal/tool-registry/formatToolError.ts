import {IDynaError} from "dyna-error";

/** What the model reads for a failure without a `userMessage`: a bug of the tool or an outage of what it calls, not the model's input. */
export const TOOL_FAILURE_TEXT = "The tool failed with an internal error; the input was not the cause. Do not retry it unchanged; tell the user the action could not be completed and go on without it.";
/** Appended when the error says `canRetry: false`. */
export const TOOL_NO_RETRY_TEXT = "Do not retry this call.";
/** The longest `userMessage` the model reads; a longer one is cut. Unlike a tool's output, an error has no other cap. */
export const MAX_TOOL_ERROR_USER_MESSAGE_CHARS = 2_000;
/** Appended where a `userMessage` was cut. */
const CUT_MARKER = " [cut]";

/**
 * asDynaError -- the error as a `dynaError`, or undefined for any other value
 *
 * # About
 *
 * > The one guard for "did this come with the fields the model may read".
 *
 * `dyna-error` marks its instances with `isDynaError`; a plain `Error`, a string or a rejection value has no `userMessage`,
 * `code` or `status` to read.
 *
 * # Who needs it
 *
 * `formatToolError`, `ToolRegistry.execute` (to tell a tool's own `dynaError` from a foreign throw) and `runAgentLoop`
 * (the `errorCode` of the failed result).
 */
export const asDynaError = (error: unknown): IDynaError | undefined => (
  typeof error === "object" && error !== null && (error as IDynaError).isDynaError === true
    ? error as IDynaError
    : undefined
);

/**
 * formatToolError -- the one line the model reads as the result of a failed tool call
 *
 * # About
 *
 * > `code: 82758244, status: 404, userMessage: No order with id 4711; ask for the number on the invoice`
 *
 * Only the fields that are safe for the end user: the `code` (a locator the user can quote to support), the `status` (the
 * class of the failure) and the `userMessage` (what went wrong and how to proceed). A field the error does not carry is left
 * out. Without a `userMessage` the model reads `TOOL_FAILURE_TEXT`: the error is a bug or an outage, and its `message` is for
 * the developer. `canRetry: false` appends `TOOL_NO_RETRY_TEXT`. A `userMessage` over `MAX_TOOL_ERROR_USER_MESSAGE_CHARS` is cut
 * there, marked `[cut]`: the success output's cap does not apply to an error, and a library deep inside the tool may throw a
 * `dynaError` with a long text.
 *
 * # Who needs it
 *
 * `runAgentLoop.executeTool`, for the `{error}` output of a failed call; `ToolRegistry.execute`, for `IToolErrorReport.modelText`.
 */
export const formatToolError = (error: unknown): string => {
  const dyna = asDynaError(error);
  const fields = [
    dyna?.code === undefined ? undefined : `code: ${dyna.code}`,
    dyna?.status === undefined ? undefined : `status: ${dyna.status}`,
    `userMessage: ${cut(dyna?.userMessage ?? TOOL_FAILURE_TEXT)}`,
  ].filter((field): field is string => field !== undefined);
  const line = fields.join(", ");
  return dyna?.canRetry === false ? `${line} ${TOOL_NO_RETRY_TEXT}` : line;
};

const cut = (text: string): string =>
  text.length > MAX_TOOL_ERROR_USER_MESSAGE_CHARS ? `${text.slice(0, MAX_TOOL_ERROR_USER_MESSAGE_CHARS)}${CUT_MARKER}` : text;
