import {ICallSignal} from "./makeCallSignal";

/** True when `signal.reason` is the `TimeoutError` of `AbortSignal.timeout`. */
const isTimeout = (signal: AbortSignal): boolean => {
  const reason: unknown = signal.reason;
  return typeof reason === "object" &&
    reason !== null &&
    "name" in reason &&
    reason.name === "TimeoutError";
};

/**
 * abortReason -- why an aborted call stopped, in the words of its FAILED response
 *
 * # About
 *
 * > "The call was aborted" for the caller's signal, "The call timed out after N ms" for the call's deadline.
 *
 * The deadline is recognised by its own signal (`ICallSignal.deadline`), not by the reason's name: a `TimeoutError` the caller
 * passed as `abortSignal` (its own `AbortSignal.timeout`) reads "The call timed out", without a number the gateway did not set.
 *
 * # Who needs it
 *
 * `makeAbortedResponse`; `settleRun`, for the error result of a tool call the abort cut; `AIGateway.continueRun`, to close a
 * resumed run that broke while aborted with the same words.
 */
export const abortReason = (
  {callSignal}: {
    /** The call's signal, already aborted. */
    callSignal: ICallSignal;
  },
): string => {
  const {
    signal,
    deadline,
    timeoutMs,
    shutdown,
  } = callSignal;
  if (deadline?.aborted && signal.reason === deadline.reason && timeoutMs !== undefined) {
    return `The call timed out after ${timeoutMs} ms`;
  }
  if (shutdown?.aborted && signal.reason === shutdown.reason) return "The call was aborted: the gateway is shutting down";
  return isTimeout(signal) ? "The call timed out" : "The call was aborted";
};

/**
 * isTimedOut -- whether a timeout ended the call, the gateway's deadline or the caller's own
 *
 * # About
 *
 * > The issue code of the response: `call_timed_out` when true, `call_aborted` otherwise.
 *
 * # Who needs it
 *
 * `makeAbortedResponse`.
 */
export const isTimedOut = (
  {callSignal}: {
    /** The call's signal, already aborted. */
    callSignal: ICallSignal;
  },
): boolean => isTimeout(callSignal.signal);
