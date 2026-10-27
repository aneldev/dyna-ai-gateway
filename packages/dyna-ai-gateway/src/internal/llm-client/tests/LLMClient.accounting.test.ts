import {
  MockLanguageModelV4,
  simulateReadableStream,
} from "ai/test";

import {
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../../../contracts";

import {EModelProvider} from "../../model-registry";
import {
  ITraceEntry,
  ETraceKind,
} from "../../trace";

import {createLanguageModel} from "../utils/createLanguageModel";
import {
  ILLMClientSetup,
  makeLLMClientSetup,
  makeModel,
  makeRequest,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createLanguageModel");

// 10 input and 2 output tokens per call. model-a costs 1 USD / 1M input and 2 USD / 1M output tokens.
const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 2,
    text: 2,
    reasoning: undefined,
  },
};
const COST_OF_ONE_CALL = (10 * 1 + 2 * 2) / 1_000_000;

const meta = {
  tenantId: "tenant-a",
  userId: "user-a",
  threadId: "thread-1",
  runId: "run-1",
  kind: ETraceKind.CHAT,
};

type TStream = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doStream"];
type TStreamResult = Awaited<ReturnType<Extract<TStream, (...args: never[]) => unknown>>>;
type TChunk = TStreamResult["stream"] extends ReadableStream<infer TPart> ? TPart : never;

const toolCallChunks: TChunk[] = [
  {
    type: "stream-start",
    warnings: [],
  },
  {
    type: "tool-call",
    toolCallId: "call-1",
    toolName: "get_invoice",
    input: "{}",
  },
  {
    type: "finish",
    finishReason: {
      unified: "tool-calls",
      raw: undefined,
    },
    usage,
  },
];

const textChunks: TChunk[] = [
  {
    type: "stream-start",
    warnings: [],
  },
  {
    type: "text-start",
    id: "text-1",
  },
  {
    type: "text-delta",
    id: "text-1",
    delta: "done",
  },
  {
    type: "text-end",
    id: "text-1",
  },
  {
    type: "finish",
    finishReason: {
      unified: "stop",
      raw: undefined,
    },
    usage,
  },
];

/** A client whose mock model answers "hello" when generating, and streams a tool call and then a text when running. */
const setup = async (): Promise<ILLMClientSetup> => {
  let streamCall = 0;
  jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{
        type: "text",
        text: "hello",
      }],
      finishReason: {
        unified: "stop",
        raw: undefined,
      },
      usage,
      warnings: [],
    }),
    doStream: async () => ({stream: simulateReadableStream({chunks: streamCall++ === 0 ? toolCallChunks : textChunks})}),
  }));
  return makeLLMClientSetup([makeModel("model-a", EModelProvider.OPENAI)], {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}});
};

const loadEntries = ({trace}: ILLMClientSetup): Promise<ITraceEntry[]> =>
  trace.query({
    tenantId: "tenant-a",
    filters: {},
    skip: 0,
    limit: 100,
  });

describe("LLMClient — every call is checked, reported and traced", () => {
  test("complete records a trace entry with the kind and the ids of the call", async () => {
    const context = await setup();
    await context.client.complete({
      request: makeRequest(),
      meta,
    });
    expect(await loadEntries(context)).toEqual([expect.objectContaining({
      tenantId: "tenant-a",
      userId: "user-a",
      threadId: "thread-1",
      runId: "run-1",
      kind: ETraceKind.CHAT,
      modelId: "model-a",
    })]);
  });

  test("the entry's id is the traceId of the result", async () => {
    const context = await setup();
    const result = await context.client.complete({
      request: makeRequest(),
      meta,
    });
    expect((await loadEntries(context))[0].id).toBe(result.traceId);
  });

  test("the entry holds the request, the result and the usage", async () => {
    const context = await setup();
    const request = makeRequest();
    const result = await context.client.complete({
      request,
      meta,
    });
    const [entry] = await loadEntries(context);
    expect([entry.request, entry.result, entry.usage]).toEqual([request, result, result.usage]);
  });

  test("the entry's costUsd is the cost of the call's tokens", async () => {
    const context = await setup();
    await context.client.complete({
      request: makeRequest(),
      meta,
    });
    expect((await loadEntries(context))[0].costUsd).toBeCloseTo(COST_OF_ONE_CALL, 12);
  });

  test("complete reports the input and output tokens of the call to the usage adapter", async () => {
    const context = await setup();
    await context.client.complete({
      request: makeRequest(),
      meta,
    });
    expect(context.usageAdapter.addUsageCalls.map(call => call.usage)).toEqual([{
      inputTokens: 10,
      outputTokens: 2,
    }]);
  });

  test("every step of a run records its own entry, with the kind of the run", async () => {
    const context = await setup();
    await context.client.run({
      request: makeRequest(),
      meta: {
        ...meta,
        kind: ETraceKind.RUN_STEP,
      },
      tools: [],
      hooks: {
        executeTool: async (): Promise<unknown> => ({total: 30}),
        decideToolCall: (): TToolCallPolicyResult => ({verdict: EToolCallVerdict.ALLOW}),
        prepareStep: (): [] => [],
        endsRun: (): boolean => false,
        onEvent: (): void => undefined,
      },
      limits: {maxSteps: 5},
    });
    expect((await loadEntries(context)).map(entry => entry.kind)).toEqual([ETraceKind.RUN_STEP, ETraceKind.RUN_STEP]);
  });

  test("a run's outcome lists the ids of the entries of its steps", async () => {
    const context = await setup();
    const outcome = await context.client.run({
      request: makeRequest(),
      meta: {
        ...meta,
        kind: ETraceKind.RUN_STEP,
      },
      tools: [],
      hooks: {
        executeTool: async (): Promise<unknown> => ({total: 30}),
        decideToolCall: (): TToolCallPolicyResult => ({verdict: EToolCallVerdict.ALLOW}),
        prepareStep: (): [] => [],
        endsRun: (): boolean => false,
        onEvent: (): void => undefined,
      },
      limits: {maxSteps: 5},
    });
    expect((await loadEntries(context)).map(entry => entry.id)).toEqual(outcome.traceIds);
  });

});
