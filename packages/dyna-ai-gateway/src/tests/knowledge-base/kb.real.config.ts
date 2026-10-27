import {
  IAIGatewayConfig,
  IChunkFilters,
  InMemoryModelRegistryRepository,
} from "../..";

import {
  openAiEmbeddingModel,
  openAiModel,
} from "../internal/samples/models";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The scope of a call that searches the whole knowledge base of the tenant. */
export const allLibraries: IChunkFilters = {
  libraryIds: "all",
  bookIds: [],
};

/**
 * Knowledge base on OpenAI: the embedding model is registered next to the chat model, so documents can be ingested and searched.
 * Working memory and the query rewriter are on, so a follow-up is rewritten into a standalone query before the search.
 * The test ingests `nordwindReturnsDocument` (invented facts the model cannot know) and searches `allLibraries`.
 */
export const gatewayConfigKb: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [openAiModel, openAiEmbeddingModel]})},
  workingMemory: {enabled: true},
  queryRewriter: {enabled: true},
};
