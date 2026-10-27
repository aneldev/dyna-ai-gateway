import {
  ILLMClientEvent,
  ELLMClientEventKind,
} from "../../internal";
import {
  TGatewayResponse,
  EGatewayResponseKind,
} from "../../types";
import {
  TOnCallEventHandler,
  startCall,
} from "../startCall";

const RESPONSE: TGatewayResponse = {
  kind: EGatewayResponseKind.FAILED,
  threadId: "thread-1",
  reason: "test",
  issues: [],
};

const makeEvent = (text: string): ILLMClientEvent => ({
  kind: ELLMClientEventKind.TEXT_DELTA,
  text,
  stepIndex: 0,
});

const readAll = async (events: AsyncIterable<ILLMClientEvent>): Promise<string[]> => {
  const texts: string[] = [];
  for await (const event of events) texts.push(event.text ?? "");
  return texts;
};

/** A call the test drives: it sends events and settles when told to. */
const makeControlledCall = (): {
  execute: (args: { onEvent: TOnCallEventHandler }) => Promise<TGatewayResponse>;
  send(text: string): void;
  resolve(): void;
  reject(error: unknown): void;
} => {
  let onEvent: TOnCallEventHandler = () => undefined;
  let resolve: (response: TGatewayResponse) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  return {
    execute: (args): Promise<TGatewayResponse> => {
      onEvent = args.onEvent;
      return new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      });
    },
    send: (text): void => onEvent({event: makeEvent(text)}),
    resolve: (): void => resolve(RESPONSE),
    reject: (error): void => reject(error),
  };
};

describe("startCall", () => {
  test("the events arrive in order while the call runs, and the stream ends with the response", async () => {
    const controlled = makeControlledCall();
    const call = startCall({execute: controlled.execute});
    const iterator = call.events[Symbol.asyncIterator]();
    await Promise.resolve();

    controlled.send("a");
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: makeEvent("a"),
    });
    controlled.send("b");
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: makeEvent("b"),
    });
    controlled.resolve();
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(call.response).resolves.toBe(RESPONSE);
  });

  test("events sent after `events` was accessed and before it is read are kept for the reader", async () => {
    const {
      events,
      response,
    } = startCall({
      execute: async ({onEvent}) => {
        onEvent({event: makeEvent("a")});
        onEvent({event: makeEvent("b")});
        return RESPONSE;
      },
    });
    await response;
    await expect(readAll(events)).resolves.toEqual(["a", "b"]);
  });

  test("a call whose `events` is not accessed collects nothing", async () => {
    const call = startCall({
      execute: async ({onEvent}) => {
        onEvent({event: makeEvent("a")});
        return RESPONSE;
      },
    });
    await call.response;
    // Accessed only now: what was sent before was never kept
    await expect(readAll(call.events)).resolves.toEqual([]);
  });

  test("a reader that stops early ends its stream and does not hold the call", async () => {
    const controlled = makeControlledCall();
    const call = startCall({execute: controlled.execute});
    const iterator = call.events[Symbol.asyncIterator]();
    await Promise.resolve();
    controlled.send("a");
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: makeEvent("a"),
    });
    await iterator.return?.();
    controlled.send("b");
    controlled.resolve();
    await expect(call.response).resolves.toBe(RESPONSE);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  test("a call that throws rejects the response, and the stream throws the same error after the events sent before it", async () => {
    const error = new Error("provider down");
    const {
      events,
      response,
    } = startCall({
      execute: async ({onEvent}) => {
        onEvent({event: makeEvent("a")});
        throw error;
      },
    });
    await expect(response).rejects.toBe(error);
    const texts: string[] = [];
    await expect((async (): Promise<void> => {
      for await (const event of events) texts.push(event.text ?? "");
    })()).rejects.toBe(error);
    expect(texts).toEqual(["a"]);
  });

  test("a caller that reads only the events gets no unhandled rejection", async () => {
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const call = startCall({
        execute: async () => {
          throw new Error("provider down");
        },
      });
      await expect(readAll(call.events)).rejects.toThrow("provider down");
      await new Promise(setImmediate);
      expect(unhandled).not.toHaveBeenCalled();
    }
    finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  test("a stream nobody reads does not hold the call", async () => {
    const call = startCall({
      execute: async ({onEvent}) => {
        for (let index = 0; index < 1000; index++) onEvent({event: makeEvent(String(index))});
        return RESPONSE;
      },
    });
    await expect(call.response).resolves.toBe(RESPONSE);
  });

  test("events sent after the call settled are dropped", async () => {
    let lateOnEvent: TOnCallEventHandler = () => undefined;
    const {
      events,
      response,
    } = startCall({
      execute: async ({onEvent}) => {
        lateOnEvent = onEvent;
        return RESPONSE;
      },
    });
    await response;
    lateOnEvent({event: makeEvent("late")});
    await expect(readAll(events)).resolves.toEqual([]);
  });

  test("the events can be read once", async () => {
    const call = startCall({execute: async () => RESPONSE});
    await readAll(call.events);
    expect(() => call.events[Symbol.asyncIterator]()).toThrow(expect.objectContaining({code: 5373917850267}));
  });
});
