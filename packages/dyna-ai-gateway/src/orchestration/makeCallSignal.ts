import {dynaError} from "dyna-error";

/** The largest delay Node's timers take; a `timeoutMs` above it would fire at once. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * The one signal of a call, with what is needed to say why it fired.
 *
 * Built by `makeCallSignal` for `AIGateway.ask`, `run` and `resume`; read by `abortReason` and `makeAbortedResponse`; every layer
 * that waits gets `signal`.
 */
export interface ICallSignal {
  /** The merged signal every layer of the call checks: the caller's abort and the deadline. */
  signal: AbortSignal;
  /**
   * The deadline's own signal, when `timeoutMs` was given.
   * Its reason on `signal` means the deadline is what fired.
   */
  deadline?: AbortSignal;
  /** The call's `timeoutMs`, named in the reason of a response the deadline ended. */
  timeoutMs?: number;
  /** The gateway's shutdown signal (D96). Its reason on `signal` means the shutdown is what fired. */
  shutdown?: AbortSignal;
}

/**
 * makeCallSignal -- the one abort signal of a call
 *
 * # About
 *
 * > The caller's signal and the call's deadline, merged into one.
 *
 * Builds the signal every layer of a call checks: the model calls, the agent loop, the tools, the guardrail rules.
 *
 * - `abortSignal` alone: that signal.
 * - `timeoutMs` alone: `AbortSignal.timeout(timeoutMs)`, whose reason is a `TimeoutError`.
 * - Both: `AbortSignal.any` of the two, so the first one that fires wins and its reason says who did.
 * - `shutdownSignal` (the gateway's, D96) joins the merge the same way.
 * - Neither: `undefined`, and nothing is checked.
 *
 * Called once per call by `AIGateway.ask`, `run` and `resume`, before the thread's lease is taken and before anything is stored.
 *
 * # Who needs it
 *
 * `AIGateway.ask`, `run` and `executeResume`.
 *
 * # Pitfalls
 *
 * A `timeoutMs` that is not a positive integer, or is above 2 147 483 647 ms (Node's largest timer), is a 400: a deadline of 0,
 * NaN or 1.5 would abort every call at once or throw out of the timer.
 */
export const makeCallSignal = (
  {
    abortSignal,
    timeoutMs,
    shutdownSignal,
  }: {
    /** The caller's signal (`IGatewayAskInput.abortSignal`): the "stop" button, the HTTP request. */
    abortSignal?: AbortSignal;
    /** The call's deadline in milliseconds (`IGatewayAskInput.timeoutMs`): a positive integer up to Node's largest timer. */
    timeoutMs?: number;
    /** The gateway's shutdown signal for this call (D96): aborted when the grace period of `AIGateway.shutdown` passes. */
    shutdownSignal?: AbortSignal;
  },
): ICallSignal | undefined => {
  if (timeoutMs !== undefined && !(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS)) {
    throw dynaError({
      code: 5376312450001,
      status: 400,
      message: `AIGateway: timeoutMs must be a positive integer of milliseconds up to ${MAX_TIMEOUT_MS}, got [${String(timeoutMs)}]`,
      data: {timeoutMs},
    });
  }
  const deadline = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
  const signals = [
    ...abortSignal ? [abortSignal] : [],
    ...shutdownSignal ? [shutdownSignal] : [],
    ...deadline ? [deadline] : [],
  ];
  const [first] = signals;
  if (!first) return undefined;
  const signal = signals.length === 1 ? first : AbortSignal.any(signals);
  return {
    signal,
    ...deadline ? {deadline} : {},
    ...timeoutMs === undefined ? {} : {timeoutMs},
    ...shutdownSignal ? {shutdown: shutdownSignal} : {},
  };
};
