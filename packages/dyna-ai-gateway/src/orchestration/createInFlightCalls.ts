import {dynaError} from "dyna-error";

/**
 * The calls in flight of one gateway: `ask`, `run` and `resume` register themselves so a shutdown (D96) can wait for
 * them, abort the ones past the grace period, and refuse new ones with a 503.
 *
 * One per `AIGateway`, created by `createInFlightCalls`; read by `AIGateway.shutdown`.
 */
export interface IInFlightCalls {
  /**
   * Registers a call: the signal the shutdown aborts it through, and the `end` the call runs when it settles.
   * Throws a 503 once `close` was called.
   */
  begin(): {signal: AbortSignal; end: () => void};

  /** Refuses every call from now on. */
  close(): void;

  /** Aborts every call still in flight through its signal. */
  abortAll(): void;

  /** Resolves once no call is in flight. */
  whenEmpty(): Promise<void>;
}

export const createInFlightCalls = (): IInFlightCalls => {
  const calls = new Map<AbortController, Promise<void>>();
  let closed = false;

  return {
    begin: (): {signal: AbortSignal; end: () => void} => {
      if (closed) {
        throw dynaError({
          code: 5377780695122,
          status: 503,
          message: "AIGateway: the gateway is shutting down; no new call is taken",
          userMessage: "The service is restarting; please try again in a moment",
        });
      }
      const controller = new AbortController();
      let end = (): void => undefined;
      calls.set(controller, new Promise<void>(resolve => {
        end = resolve;
      }));
      return {
        signal: controller.signal,
        end: (): void => {
          end();
          calls.delete(controller);
        },
      };
    },
    close: (): void => {
      closed = true;
    },
    abortAll: (): void => {
      calls.forEach((_done, controller) => controller.abort(dynaError({
        code: 5377780695133,
        status: 503,
        message: "AIGateway: the gateway is shutting down; the call was aborted",
      })));
    },
    whenEmpty: async (): Promise<void> => {
      for (let pending = [...calls.values()]; pending.length; pending = [...calls.values()]) await Promise.all(pending);
    },
  };
};
