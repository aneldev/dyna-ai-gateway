import {z} from "zod";
import {
  MockLanguageModelV4,
  simulateReadableStream,
} from "ai/test";

import {
  IToolCallPart,
  EToolCallVerdict,
} from "../../../contracts";

import {EModelProvider} from "../../model-registry";
import {defineTool} from "../../tool-registry";

import {ERunOutcomeStatus} from "../types";
import {createLanguageModel} from "../utils/createLanguageModel";
import {
  makeLLMClient,
  makeModel,
  makeRequest,
  meta,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createLanguageModel");

type TStream = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doStream"];
type TStreamResult = Awaited<ReturnType<Extract<TStream, (...args: never[]) => unknown>>>;
type TChunk = TStreamResult["stream"] extends ReadableStream<infer TPart> ? TPart : never;

const finish = (unified: "stop" | "tool-calls"): TChunk => ({
  type: "finish",
  finishReason: {
    unified,
    raw: undefined,
  },
  usage: {
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
  },
});

const steps: TChunk[][] = [
  [
    {
      type: "stream-start",
      warnings: [],
    },
    {
      type: "tool-call",
      toolCallId: "call-get_order",
      toolName: "get_order",
      input: JSON.stringify({orderNo: "88231"}),
    },
    finish("tool-calls"),
  ],
  [
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
      delta: JSON.stringify({orderNo: "88231"}),
    },
    {
      type: "text-end",
      id: "text-1",
    },
    finish("stop"),
  ],
];

/**
 * A run with an outputSchema: a step that ends in tool calls has no answer to parse yet. Its tool calls run and the next step
 * gives the structured answer, instead of the step being taken for an empty final answer.
 */
test("a run with an outputSchema executes the tool call of a step and parses the answer of the next one", async () => {
  let call = 0;
  jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({doStream: async () => ({stream: simulateReadableStream({chunks: steps[call++]})})}));
  const getOrder = defineTool({
    name: "get_order",
    description: "Reads an order",
    inputSchema: z.object({orderNo: z.string()}),
    tags: [],
    policy: EToolCallVerdict.ALLOW,
    execute: async (): Promise<string> => "an order",
  });
  const executed: IToolCallPart[] = [];
  const client = await makeLLMClient([makeModel("model-a", EModelProvider.OPENAI)], {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}});

  const outcome = await client.run({
    request: makeRequest({outputSchema: z.object({orderNo: z.string()})}),
    meta,
    tools: [getOrder],
    hooks: {
      executeTool: async ({call: toolCall}): Promise<unknown> => {
        executed.push(toolCall);
        return {status: "delivered"};
      },
      decideToolCall: () => ({verdict: EToolCallVerdict.ALLOW}),
      prepareStep: () => [getOrder],
      endsRun: (): boolean => false,
      onEvent: (): void => undefined,
    },
    limits: {maxSteps: 5},
  });

  expect([outcome.status, executed.map(toolCall => toolCall.toolName), outcome.result?.structured]).toEqual([
    ERunOutcomeStatus.DONE,
    ["get_order"],
    {orderNo: "88231"},
  ]);
});
