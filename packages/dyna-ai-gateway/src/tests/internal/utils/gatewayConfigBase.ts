import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  InMemoryBlobAdapter,
  InMemoryModelRegistryRepository,
  InMemoryPromptTemplateRepository,
  InMemoryRunRepository,
  InMemoryThreadRepository,
  InMemoryTraceRepository,
  InMemoryUsageAdapter,
  InMemoryUserMemoryRepository,
  InMemoryVectorIndexAdapter,
} from "../../..";

import {
  openAiEmbeddingModel,
  openAiModel,
} from "../samples/models";
import {sampleProfile} from "../samples/profiles";

import {loadProviderCredentials} from "./loadProviderCredentials";

export const SAMPLE_EMBEDDING_DIMENSIONS = 1536;

/**
 * The config every scenario spreads: plain chat on OpenAI, in-memory adapters, silent trace, no tools, no memory, no knowledge base.
 * A test's `<test>.config.ts` spreads it and overrides only what the test is about; the sandbox swaps in its console trace.
 * The provider keys come from the repo-root `.env` (the only place `loadProviderCredentials` is called).
 */
export const gatewayConfigBase: IAIGatewayConfig = {
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [openAiModel]})},
  aiProfileStore: {repository: new InMemoryAIProfileRepository({profiles: [sampleProfile]})},
  promptTemplateStore: {repository: new InMemoryPromptTemplateRepository()},
  threadStore: {repository: new InMemoryThreadRepository()},
  fileStore: {
    adapter: new InMemoryBlobAdapter(),
    path: "tests/ai-files",
  },
  workingMemory: {enabled: false},
  userMemoryStore: {
    repository: new InMemoryUserMemoryRepository(),
    enabled: false,
  },
  // No knowledge base: the embedding model is not registered, so nothing is ingested and no call searches
  embedder: {
    embeddingModelId: openAiEmbeddingModel.id,
    dimensions: SAMPLE_EMBEDDING_DIMENSIONS,
  },
  vectorStore: {
    adapter: new InMemoryVectorIndexAdapter({
      embeddingModelId: openAiEmbeddingModel.id,
      dimensions: SAMPLE_EMBEDDING_DIMENSIONS,
    }),
  },
  queryRewriter: {enabled: false},
  runStore: {repository: new InMemoryRunRepository()},
  humanGate: {userQuestions: {enabled: false}},
  usageGuard: {adapter: new InMemoryUsageAdapter()},
  llmClient: {providers: loadProviderCredentials()},
  trace: {repository: new InMemoryTraceRepository()},
  defaultCheapModelId: openAiModel.id,
};
