import {dynaError} from "dyna-error";

import {ILLMClientEvent} from "../internal";
import {
  IGatewayCall,
  TGatewayResponse,
} from "../types";

/** Hands one event of the call to its stream. */
export type TOnCallEventHandler = (args: { event: ILLMClientEvent }) => void;

/**
 * Starts a call and returns it at once (D38): its events as a stream, its response as a promise.
 * `execute` is the call. Its events are collected only from the moment `events` is accessed: a caller that awaits only
 * `response` costs no memory for them. Once accessed, they are buffered until read, so a slow reader never slows the call;
 * a reader that stops early (`break`) ends the collecting. The stream ends when the call settles and throws the call's
 * error after the events sent before it.
 */
export const startCall = <TStructured>(
  {execute}: {
    execute: (args: { onEvent: TOnCallEventHandler }) => Promise<TGatewayResponse<TStructured>>;
  },
): IGatewayCall<TStructured> => {
  const queue = createEventQueue();
  const response =
    Promise.resolve()
      .then(() => execute({onEvent: queue.push}))
      .then(
        (result): TGatewayResponse<TStructured> => {
          queue.end();
          return result;
        },
        (error: unknown): never => {
          queue.fail(error);
          throw error;
        },
      );
  // Handled here: a caller that reads only `events` gets the error there, not as an unhandled rejection
  response.catch(() => undefined);

  return {
    // A getter: accessing `events` is what starts the collecting
    get events(): AsyncIterable<ILLMClientEvent> {
      queue.collect();
      return queue.events;
    },
    response,
  };
};

interface IEventQueue {
  events: AsyncIterable<ILLMClientEvent>;
  /** Starts keeping the pushed events; before it, push drops them. */
  collect(): void;
  push: TOnCallEventHandler;

  end(): void;

  fail(error: unknown): void;
}

/**
 * A buffered stream with one reader: push never waits, the reader waits for the next event or the end.
 * Nothing is kept before `collect()` or after the reader stopped.
 */
const createEventQueue = (): IEventQueue => {
  const buffer: ILLMClientEvent[] = [];
  let collecting = false;
  let readerStopped = false;
  let ended = false;
  let failure: { error: unknown } | undefined;
  let wakeReader: (() => void) | undefined;
  let hasReader = false;

  const wake = (): void => {
    wakeReader?.();
    wakeReader = undefined;
  };
  const waitForWake = (): Promise<void> => new Promise(resolve => {
    wakeReader = resolve;
  });

  const read = async function* (): AsyncGenerator<ILLMClientEvent> {
    try {
      for (; ;) {
        const event = buffer.shift();
        if (event) {
          yield event;
          continue;
        }
        if (failure) throw failure.error;
        if (ended) return;
        await waitForWake();
      }
    }
    finally {
      // The reader is done (end, error or break): keep nothing more
      readerStopped = true;
      buffer.length = 0;
    }
  };

  return {
    events: {
      [Symbol.asyncIterator]: (): AsyncIterator<ILLMClientEvent> => {
        if (hasReader) {
          throw dynaError({
            code: 5373917850267,
            status: 400,
            message: "AIGateway: the events of a call can be read once; one reader only",
          });
        }
        hasReader = true;
        return read();
      },
    },
    collect: (): void => {
      collecting = true;
    },
    push: ({event}): void => {
      if (!collecting || readerStopped || ended || failure) return;
      buffer.push(event);
      wake();
    },
    end: (): void => {
      ended = true;
      wake();
    },
    fail: (error): void => {
      failure = {error};
      wake();
    },
  };
};
