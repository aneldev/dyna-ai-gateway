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
 * ingestSampleKb -- the sample knowledge base, when the config can embed
 *
 * # About
 *
 * > Registered embedding model: the samples are ingested and every call searches every library. Otherwise nothing, and no call searches.
 *
 * One embedding call per sample document; a line per document on the `INGEST_SAMPLE_KB` channel. Returns the `kbFilters`
 * every call of the session passes: `libraryIds: "all"` after an ingestion, an empty list without one.
 *
 * # Who needs it
 *
 * `createSandboxAIGateway`, right after the gateway is built.
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
