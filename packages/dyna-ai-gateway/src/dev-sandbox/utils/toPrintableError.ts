/**
 * toPrintableError -- an error as JSON can show it
 *
 * # About
 *
 * > Its `toJSON` when it has one (a `dynaError`), else its message, else the value as it is.
 *
 * # Who needs it
 *
 * `printToolErrorReport` and `printRuleErrorReport`, for the error of the report; `runChatSession`, for a thrown error.
 */
export const toPrintableError = (error: unknown): unknown => (
  hasToJson(error)
    ? error.toJSON()
    : error instanceof Error
      ? {message: error.message}
      : error
);

/** An object with a `toJSON` method, as `dynaError` instances have. */
const hasToJson = (value: unknown): value is {toJSON(): unknown} => (
  typeof value === "object" && value !== null && typeof (value as {toJSON?: unknown}).toJSON === "function"
);
