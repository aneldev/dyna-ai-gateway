/** The reason `AbortSignal.timeout` aborts with; for a controller a test puts in its place. */
export const makeTimeoutError = (): DOMException => new DOMException("The operation was aborted due to timeout", "TimeoutError");
