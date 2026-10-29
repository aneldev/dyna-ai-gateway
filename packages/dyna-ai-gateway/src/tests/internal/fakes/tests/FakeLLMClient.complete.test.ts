import {
  ILLMClientEvent,
  IModelRequest,
  IModelResult,
  ELLMClientEventKind,
  EFinishReason,
  ETraceKind,
} from "../../../..";

import {FakeLLMClient} from "../FakeLLMClient";

const request: IModelRequest = {
  modelId: "model-a",
  system: [{text: "You are a test"}],
  messages: [],
  maxOutputTokens: 500,
};

const meta = {
  tenantId: "tenant-a",
  kind: ETraceKind.CHAT,
};

const makeResult = (text: string): IModelResult => ({
  modelId: "model-a",
  text,
  toolCalls: [],
  finishReason: EFinishReason.STOP,
  usage: {
    inputTokens: 10,
    outputTokens: 2,
  },
  latencyMs: 5,
  traceId: "trace-1",
});

describe("FakeLLMClient — complete, embed, providers", () => {
  test("complete returns the enqueued results in order", async () => {
    const llmClient = new FakeLLMClient();
    llmClient.enqueueComplete(makeResult("first"));
    llmClient.enqueueComplete(makeResult("second"));
    const texts = [
      (await llmClient.complete({
        request,
        meta,
      })).text,
      (await llmClient.complete({
        request,
        meta,
      })).text,
    ];
    expect(texts).toEqual(["first", "second"]);
  });

  test("complete throws when no result is enqueued", async () => {
    const llmClient = new FakeLLMClient();
    await expect(llmClient.complete({
      request,
      meta,
    })).rejects.toThrow("no result is enqueued");
  });

  test("complete records the arguments of the call", async () => {
    const llmClient = new FakeLLMClient();
    llmClient.enqueueComplete(makeResult("answer"));
    await llmClient.complete({
      request,
      meta,
    });
    expect(llmClient.completeCalls).toEqual([{
      request,
      meta,
    }]);
  });

  test("complete emits TEXT_DELTA with the text, then DONE", async () => {
    const llmClient = new FakeLLMClient();
    const events: ILLMClientEvent[] = [];
    llmClient.enqueueComplete(makeResult("answer"));
    await llmClient.complete({
      request,
      meta,
      hooks: {onEvent: ({event}): void => void events.push(event)},
    });
    expect(events.map(event => [event.kind, event.text])).toEqual([
      [ELLMClientEventKind.TEXT_DELTA, "answer"],
      [ELLMClientEventKind.DONE, undefined],
    ]);
  });

  test("embed returns the enqueued vectors", async () => {
    const llmClient = new FakeLLMClient();
    llmClient.enqueueEmbed([[1, 0], [0, 1]]);
    expect(await llmClient.embed({
      modelId: "embedding-a",
      texts: ["a", "b"],
      meta,
    })).toEqual([[1, 0], [0, 1]]);
  });

  test("embed throws when no vectors are enqueued", async () => {
    const llmClient = new FakeLLMClient();
    await expect(llmClient.embed({
      modelId: "embedding-a",
      texts: ["a"],
      meta,
    })).rejects.toThrow("no vectors are enqueued");
  });

  test("providers returns the providers given to the constructor", () => {
    const llmClient = new FakeLLMClient([]);
    expect(llmClient.providers).toEqual([]);
  });
});
