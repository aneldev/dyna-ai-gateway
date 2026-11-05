import {
  IAIGatewayConfig,
  IChunk,
  IKbDocument,
  InMemoryModelRegistryRepository,
  InMemoryVectorIndexAdapter,
} from "../..";

import {
  openAiEmbeddingModel,
  openAiModel,
} from "../internal/samples/models";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

const WORDS = ["refund", "invoice", "weather"];

/** The fake embedding of the scenario: a vector that counts the three words, so texts about the same thing point the same way. */
export const toVector = (text: string): number[] => WORDS.map(word => text.toLowerCase().split(word).length - 1 + 0.01);

/** Two documents in two libraries, one chunk each (`refund-doc#0`, `weather-doc#0`). */
export const documents: IKbDocument[] = [
  {
    id: "refund-doc",
    bookId: "tax-book",
    libraryId: "tax",
    title: "Refunds",
    markdown: "A refund is possible within 12 months.",
    tags: [],
    language: "en",
  },
  {
    id: "weather-doc",
    bookId: "weather-book",
    libraryId: "weather",
    title: "Weather",
    markdown: "The weather of Vienna: light rain.",
    tags: [],
    language: "en",
  },
];

/** The chunks every answer was checked against, one entry per call: what the retrieval handed to the prompt. */
export const seenChunks: IChunk[][] = [];

/**
 * A knowledge base on fake embeddings (the test ingests `documents` after `embedWith(toVector)`) and an output rule that records
 * the retrieved chunks of every call, so a test reads what `k` and `minScore` let through.
 */
export const gatewayConfigKbRetrievalOverrides: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [openAiModel, openAiEmbeddingModel]})},
  // The fake vectors have one dimension per counted word
  embedder: {
    embeddingModelId: openAiEmbeddingModel.id,
    dimensions: WORDS.length,
  },
  vectorStore: {
    adapter: new InMemoryVectorIndexAdapter({
      embeddingModelId: openAiEmbeddingModel.id,
      dimensions: WORDS.length,
    }),
  },
  guardrails: {
    outputRules: [{
      name: "record_chunks",
      check: async ({evidence}) => {
        seenChunks.push(evidence.chunks);
        return [];
      },
    }],
  },
};
