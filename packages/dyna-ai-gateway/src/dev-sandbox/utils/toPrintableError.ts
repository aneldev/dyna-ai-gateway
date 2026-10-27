/** An error as JSON can show it: through its `toJSON` when it has one (a `dynaError`), else its message, else as it is. */
export const toPrintableError = (error: unknown): unknown => (
  hasToJson(error)
    ? error.toJSON()
    : error instanceof Error
      ? {message: error.message}
      : error
);

const hasToJson = (value: unknown): value is {toJSON(): unknown} => (
  typeof value === "object" && value !== null && typeof (value as {toJSON?: unknown}).toJSON === "function"
);
