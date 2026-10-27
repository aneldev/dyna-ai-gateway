import {z} from "zod";
import {
  MockLanguageModelV4,
  simulateReadableStream,
} from "ai/test";

import {
  DEFAULT_TOOL_REJECTION_TEXT,
  EPartKind,
} from "../../../contracts";

import {EModelProvider} from "../../model-registry";

import {LLMClient} from "../LLMClient";
import {
  ILLMClientEvent,
  EFinishReason,
  ELLMClientEventKind,
  EMessageRole,
} from "../types";
import {createLanguageModel} from "../utils/createLanguageModel";
import {
  findToolOutput,
  makeLLMClient,
  makeModel,
  makeRequest,
  meta,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createLanguageModel");

type TGenerate = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doGenerate"];
type TGenerateResult = Awaited<ReturnType<Extract<TGenerate, (...args: never[]) => unknown>>>;

const usage = {
  inputTokens: {
    total: 10,
    noCache: 7,
    cacheRead: 3,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 2,
    text: 2,
    reasoning: undefined,
  },
};

const makeGenerateResult = (content: TGenerateResult["content"], unified: TGenerateResult["finishReason"]["unified"] = "stop"): TGenerateResult => ({
  content,
  finishReason: {
    unified,
    raw: undefined,
  },
  usage,
  warnings: [],
});

/** Makes the mocked createLanguageModel return a mock model that answers with the given result. */
const mockModel = (result: TGenerateResult): MockLanguageModelV4 => {
  const model = new MockLanguageModelV4({doGenerate: async () => result});
  jest.mocked(createLanguageModel).mockReturnValue(model);
  return model;
};

const makeClient = (): Promise<LLMClient> =>
  makeLLMClient([makeModel("model-a", EModelProvider.OPENAI)], {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}});

describe("LLMClient", () => {
  describe("M1 — complete", () => {
    test("returns the model's text with finishReason STOP", async () => {
      mockModel(makeGenerateResult([{
        type: "text",
        text: "hello",
      }]));
      const result = await (await makeClient()).complete({
        request: makeRequest(),
        meta,
      });
      expect([result.text, result.finishReason, result.modelId]).toEqual(["hello", EFinishReason.STOP, "model-a"]);
    });

    test("returns the usage with the cached input tokens", async () => {
      mockModel(makeGenerateResult([{
        type: "text",
        text: "hello",
      }]));
      const result = await (await makeClient()).complete({
        request: makeRequest(),
        meta,
      });
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: 3,
      });
    });

    test("gives every result a traceId and a latency", async () => {
      mockModel(makeGenerateResult([{
        type: "text",
        text: "hello",
      }]));
      const result = await (await makeClient()).complete({
        request: makeRequest(),
        meta,
      });
      expect([typeof result.traceId, result.traceId.length > 0, result.latencyMs >= 0]).toEqual(["string", true, true]);
    });

    test("sends the system prompt and the messages to the model, with the request's output cap", async () => {
      const model = mockModel(makeGenerateResult([{
        type: "text",
        text: "hello",
      }]));
      await (await makeClient()).complete({
        request: makeRequest({
          messages: [{
            role: EMessageRole.USER,
            parts: [{
              kind: EPartKind.TEXT,
              text: "hi",
            }],
          }],
          maxOutputTokens: 123,
        }),
        meta,
      });
      const call = model.doGenerateCalls[0];
      expect([call.prompt.map(message => message.role), call.maxOutputTokens]).toEqual([["system", "user"], 123]);
    });

    test("returns a tool request as toolCalls with finishReason TOOL_CALLS, unexecuted", async () => {
      mockModel(makeGenerateResult(
        [{
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "getInvoice",
          input: JSON.stringify({id: "4521"}),
        }],
        "tool-calls",
      ));
      const execute = jest.fn();
      const result = await (await makeClient()).complete({
        request: makeRequest(),
        meta,
        tools: [{
          name: "getInvoice",
          description: "Gets an invoice",
          inputSchema: z.object({id: z.string()}),
          tags: [],
          execute,
        }],
      });
      expect([result.toolCalls, result.finishReason, execute.mock.calls.length]).toEqual([
        [{
          kind: EPartKind.TOOL_CALL,
          callId: "call-1",
          toolName: "getInvoice",
          input: {id: "4521"},
        }],
        EFinishReason.TOOL_CALLS,
        0,
      ]);
    });

    test("sends a rejected tool result to the model as execution-denied with the text the result holds", async () => {
      const model = mockModel(makeGenerateResult([{
        type: "text",
        text: "ok",
      }]));
      const call = {
        kind: EPartKind.TOOL_CALL as const,
        callId: "call-1",
        toolName: "refund",
        input: {id: "4521"},
      };
      await (await makeClient()).complete({
        request: makeRequest({
          messages: [
            {
              role: EMessageRole.ASSISTANT,
              parts: [call],
            },
            {
              role: EMessageRole.TOOL,
              parts: [{
                kind: EPartKind.TOOL_RESULT,
                callId: "call-1",
                toolName: "refund",
                output: `${DEFAULT_TOOL_REJECTION_TEXT} Reason: too expensive`,
                rejected: true,
              }],
            },
          ],
        }),
        meta,
      });
      expect(findToolOutput(model.doGenerateCalls[0].prompt)).toEqual({
        type: "execution-denied",
        reason: `${DEFAULT_TOOL_REJECTION_TEXT} Reason: too expensive`,
      });
    });

    test("a rejected tool result without a text gets the default rejection text, never an empty result", async () => {
      const model = mockModel(makeGenerateResult([{
        type: "text",
        text: "ok",
      }]));
      await (await makeClient()).complete({
        request: makeRequest({
          messages: [
            {
              role: EMessageRole.ASSISTANT,
              parts: [{
                kind: EPartKind.TOOL_CALL,
                callId: "call-1",
                toolName: "refund",
                input: {id: "4521"},
              }],
            },
            {
              role: EMessageRole.TOOL,
              parts: [{
                kind: EPartKind.TOOL_RESULT,
                callId: "call-1",
                toolName: "refund",
                output: undefined,
                rejected: true,
              }],
            },
          ],
        }),
        meta,
      });
      expect(findToolOutput(model.doGenerateCalls[0].prompt)).toEqual({
        type: "execution-denied",
        reason: DEFAULT_TOOL_REJECTION_TEXT,
      });
    });

    test("returns the parsed structured output when the request has an outputSchema", async () => {
      mockModel(makeGenerateResult([{
        type: "text",
        text: JSON.stringify({total: 30}),
      }]));
      const result = await (await makeClient()).complete({
        request: makeRequest({outputSchema: z.object({total: z.number()})}),
        meta,
      });
      expect(result.structured).toEqual({total: 30});
    });

    test("leaves structured undefined when the model's output does not parse, and keeps the text", async () => {
      mockModel(makeGenerateResult([{
        type: "text",
        text: "not json",
      }]));
      const result = await (await makeClient()).complete({
        request: makeRequest({outputSchema: z.object({total: z.number()})}),
        meta,
      });
      expect([result.structured, result.text]).toEqual([undefined, "not json"]);
    });

    test("maps the provider's length stop to finishReason LENGTH", async () => {
      mockModel(makeGenerateResult(
        [{
          type: "text",
          text: "cut",
        }],
        "length",
      ));
      const result = await (await makeClient()).complete({
        request: makeRequest(),
        meta,
      });
      expect(result.finishReason).toBe(EFinishReason.LENGTH);
    });

    test("with hooks.onEvent it streams TEXT_DELTA events in order, then DONE", async () => {
      jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
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
                delta: "Hel",
              },
              {
                type: "text-delta",
                id: "text-1",
                delta: "lo",
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
            ],
          }),
        }),
      }));
      const events: ILLMClientEvent[] = [];
      const result = await (await makeClient()).complete({
        request: makeRequest(),
        meta,
        hooks: {onEvent: ({event}): void => void events.push(event)},
      });
      expect([result.text, events.map(event => [event.kind, event.text])]).toEqual([
        "Hello",
        [
          [ELLMClientEventKind.TEXT_DELTA, "Hel"],
          [ELLMClientEventKind.TEXT_DELTA, "lo"],
          [ELLMClientEventKind.DONE, undefined],
        ],
      ]);
    });

    test("throws a 400 with code 5372567786205 when the model's provider has no credentials", async () => {
      const client = await makeLLMClient([makeModel("model-a", EModelProvider.ANTHROPIC)], {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}});
      await expect(client.complete({
        request: makeRequest(),
        meta,
      })).rejects.toMatchObject({
        code: 5372567786205,
        status: 400,
        data: {
          provider: EModelProvider.ANTHROPIC,
          modelId: "model-a",
        },
      });
    });

    test("throws a 502 with code 5372567786196 and the provider's error as parentError when the call fails", async () => {
      const providerError = new Error("rate limited");
      jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({
        doGenerate: async () => {
          throw providerError;
        },
      }));
      const client = await makeLLMClient([makeModel("model-a", EModelProvider.OPENAI)], {
        providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}},
        maxRetries: 0,
      });
      await expect(client.complete({
        request: makeRequest(),
        meta,
      })).rejects.toMatchObject({
        code: 5372567786196,
        status: 502,
        data: {
          provider: EModelProvider.OPENAI,
          modelId: "model-a",
        },
      });
    });

    test("throws the registry's 404 for an unknown modelId", async () => {
      await expect((await makeClient()).complete({
        request: makeRequest({modelId: "missing"}),
        meta,
      })).rejects.toMatchObject({code: 5372567785992});
    });
  });

  describe("M1 — providers", () => {
    test("lists the providers that have credentials", async () => {
      const client = await makeLLMClient([], {
        providers: {
          [EModelProvider.ANTHROPIC]: {apiKey: "a"},
          [EModelProvider.OPENAI]: {apiKey: "b"},
        },
      });
      expect(client.providers).toEqual([EModelProvider.OPENAI, EModelProvider.ANTHROPIC]);
    });
  });
});
