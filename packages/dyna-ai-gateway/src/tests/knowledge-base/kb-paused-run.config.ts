import {
  IAIGatewayConfig,
  IChunkFilters,
  IKbDocument,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
  InMemoryVectorIndexAdapter,
} from "../..";

import {
  openAiEmbeddingModel,
  openAiModel,
} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

const WORDS = ["refund", "invoice", "weather"];

/** The fake embedding of the scenario: a vector that counts the three words, so texts about the same thing point the same way. */
export const toVector = (text: string): number[] => WORDS.map(word => text.toLowerCase().split(word).length - 1 + 0.01);

/** The one document of the knowledge base; its single chunk is `refund-doc#0`. */
export const refundDocument: IKbDocument = {
  id: "refund-doc",
  bookId: "tax-book",
  libraryId: "tax",
  title: "Refunds",
  markdown: "A refund is possible within 12 months.",
  tags: [],
  language: "en",
};

/** The scope of a call that searches the document's library. */
export const inTaxLibrary: IChunkFilters = {
  libraryIds: [refundDocument.libraryId],
  bookIds: [],
};

/**
 * A knowledge base on fake embeddings (the test ingests `refundDocument` after `embedWith(toVector)`) and the refund tool, which
 * pauses for approval from 100 on: the scenario of a run that searches, pauses, and resumes.
 */
export const gatewayConfigKbPausedRun: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [openAiModel, openAiEmbeddingModel]})},
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        allowedTools: [refundTool.name],
      }],
    }),
  },
  toolRegistry: {tools: [refundTool]},
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
};
