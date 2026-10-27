import {generateText} from "ai";
import {MockLanguageModelV4} from "ai/test";

describe("AI SDK under jest", () => {
  test("the ESM-only SDK loads and a mock model answers", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "text",
            text: "hello",
          },
        ],
        finishReason: {
          unified: "stop",
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
        warnings: [],
      }),
    });

    const result = await generateText({
      model,
      prompt: "hi",
    });

    expect(result.text).toBe("hello");
    expect(result.finishReason).toBe("stop");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(2);
  });
});
