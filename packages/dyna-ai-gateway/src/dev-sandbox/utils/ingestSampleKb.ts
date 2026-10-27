import {styleText} from "node:util";

import {
  IAIGatewayConfig,
  IChunkFilters,
  AIGateway,
} from "../..";
import {nordwindReturnsDocument} from "../../tests/internal/samples/kbDocuments";

import {
  devConsole,
  EDevConsole,
} from "./devConsole";

/** The documents of the sample knowledge base. */
const SAMPLE_DOCUMENTS = [nordwindReturnsDocument];

/**
 * A config has a knowledge base when its embedding model is registered: then the sample documents are ingested
 * (an embedding call per document) and every call searches every library. Otherwise nothing is ingested and no call searches.
 */
export const ingestSampleKb = async (
  {
    gateway,
    config,
    tenantId,
  }: {
    gateway: AIGateway;
    config: IAIGatewayConfig;
    tenantId: string;
  },
): Promise<IChunkFilters> => {
  const models = await gateway.modelRegistry.listModels();
  const hasEmbeddingModel = models.some(model => model.id === config.embedder.embeddingModelId);
  if (!hasEmbeddingModel) {
    return {
      libraryIds: [],
      bookIds: [],
    };
  }
  for (const doc of SAMPLE_DOCUMENTS) {
    await gateway.kbIngestor.ingestDocument({
      tenantId,
      doc,
    });
    devConsole.log(EDevConsole.INGEST_SAMPLE_KB, styleText("dim", `ingested "${doc.title}" (library ${doc.libraryId}, book ${doc.bookId})`));
  }
  return {
    libraryIds: "all",
    bookIds: [],
  };
};
