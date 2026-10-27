import {EPartKind} from "../../../contracts";

import {EModelProvider} from "../../model-registry";
import {ETraceKind} from "../../trace";

import {
  ILLMClientConfig,
  EFinishReason,
  EMessageRole,
} from "../types";
import {
  makeLLMClient,
  makeModel,
  makeRequest,
  meta,
} from "./utils/llmClientFixtures";

// Real providers. A test runs only when its key is in .env (see .env.sample); otherwise it is skipped.
const openAiKey = process.env.AIGATEWAY_TEST_OPENAI_API_KEY || "";
const anthropicKey = process.env.AIGATEWAY_TEST_ANTHROPIC_API_KEY || "";
const openAiModel = process.env.AIGATEWAY_TEST_OPENAI_MODEL || "gpt-5-mini";
const anthropicModel = process.env.AIGATEWAY_TEST_ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const describeWithOpenAi = openAiKey ? describe : describe.skip;
const describeWithAnthropic = anthropicKey ? describe : describe.skip;
const describeWithBoth = openAiKey && anthropicKey ? describe : describe.skip;

const config: ILLMClientConfig = {
  providers: {
    ...openAiKey ? {[EModelProvider.OPENAI]: {apiKey: openAiKey}} : {},
    ...anthropicKey ? {[EModelProvider.ANTHROPIC]: {apiKey: anthropicKey}} : {},
  },
};

const models = [
  makeModel("openai-model", EModelProvider.OPENAI, openAiModel),
  makeModel("anthropic-model", EModelProvider.ANTHROPIC, anthropicModel),
];

const ask = async (modelId: string): Promise<{text: string; finishReason: EFinishReason; inputTokens: number}> => {
  const client = await makeLLMClient(models, config);
  const result = await client.complete({
    request: makeRequest({
      modelId,
      system: "Answer with the single word: pong",
      messages: [{
        role: EMessageRole.USER,
        parts: [{
          kind: EPartKind.TEXT,
          text: "ping",
        }],
      }],
      maxOutputTokens: 200,
    }),
    meta,
  });
  return {
    text: result.text.toLowerCase(),
    finishReason: result.finishReason,
    inputTokens: result.usage.inputTokens,
  };
};

describeWithOpenAi("LLMClient — real provider: OpenAI", () => {
  test("OpenAI answers with text and usage", async () => {
    const answer = await ask("openai-model");
    expect([answer.text.includes("pong"), answer.inputTokens > 0]).toEqual([true, true]);
  });
});

describeWithAnthropic("LLMClient — real provider: Anthropic", () => {
  test("Anthropic answers with text and usage", async () => {
    const answer = await ask("anthropic-model");
    expect([answer.text.includes("pong"), answer.inputTokens > 0]).toEqual([true, true]);
  });
});

describeWithBoth("LLMClient — real providers: swappable", () => {
  test("the provider is swapped by the modelId alone: both answer through the same client config", async () => {
    const answers = [await ask("openai-model"), await ask("anthropic-model")];
    expect(answers.map(answer => answer.text.includes("pong"))).toEqual([true, true]);
  });
});

describeWithOpenAi("LLMClient — real provider: OpenAI embeddings (M5)", () => {
  const embeddingModel = process.env.AIGATEWAY_TEST_OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const embeddingInfo = makeModel("openai-embedding", EModelProvider.OPENAI, embeddingModel);

  const cosine = (vectorA: number[], vectorB: number[]): number => {
    const dot = vectorA.reduce((sum, value, index) => sum + value * vectorB[index], 0);
    const norm = (vector: number[]): number => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return dot / (norm(vectorA) * norm(vectorB));
  };

  test("a question is closer to the text that answers it than to an unrelated text", async () => {
    const client = await makeLLMClient([
      {
        ...embeddingInfo,
        caps: {
          ...embeddingInfo.caps,
          embeddings: true,
        },
      },
    ], config);
    const [question, answer, unrelated] = await client.embed({
      modelId: "openai-embedding",
      texts: [
        "Can I still get my money back for an invoice I paid last year?",
        "Refunds of paid invoices are possible within 12 months of the payment date.",
        "The weather station reports light rain and 14 degrees for Vienna.",
      ],
      meta: {
        tenantId: "tenant-a",
        kind: ETraceKind.EMBED,
      },
    });
    expect([question.length > 100, cosine(question, answer) > cosine(question, unrelated)]).toEqual([true, true]);
  });
});
