import {MockEmbeddingModelV4} from "ai/test";

import {InMemoryUsageAdapter} from "../../../adapters/in-memory";

import {EModelProvider} from "../../model-registry";
import {ETraceKind} from "../../trace";

import {createEmbeddingModel} from "../utils/createEmbeddingModel";
import {
  makeLLMClientSetup,
  makeModel,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createEmbeddingModel");

/**
 * An embedding is a model call like any other: asked with the kind EMBED and the tokens of the texts ("abcd" + "efghijkl" = 4 tokens, tokenized for the model's provider),
 * reported with the tokens the provider counted and no output. The ingestion of a knowledge base has no user and no profile.
 */
test("an embed is checked with the kind EMBED and reported with the provider's token count", async () => {
  jest.mocked(createEmbeddingModel).mockReturnValue(new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({values}) => ({
      embeddings: values.map(() => [1, 2]),
      usage: {tokens: 7},
      warnings: [],
    }),
  }));
  const model = makeModel("embedding-a", EModelProvider.OPENAI);
  const usageAdapter = new InMemoryUsageAdapter();
  const setup = await makeLLMClientSetup([{
    ...model,
    caps: {
      ...model.caps,
      embeddings: true,
    },
  }], {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}}, usageAdapter);

  await setup.client.embed({
    modelId: "embedding-a",
    texts: ["abcd", "efghijkl"],
    meta: {
      tenantId: "tenant-a",
      kind: ETraceKind.EMBED,
    },
  });

  expect([
    usageAdapter.checkCalls.map(call => [call.kind, call.userId, call.profileId, call.modelId, call.neededTokens]),
    usageAdapter.addUsageCalls.map(call => [call.kind, call.usage, call.traceId === usageAdapter.checkCalls[0]?.traceId]),
  ]).toEqual([
    [[ETraceKind.EMBED, undefined, undefined, "embedding-a", {
      input: 4,
      output: 0,
    }]],
    [[ETraceKind.EMBED, {
      inputTokens: 7,
      outputTokens: 0,
    }, true]],
  ]);
});
