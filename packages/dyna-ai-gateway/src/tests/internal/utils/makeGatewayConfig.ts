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

const EMBEDDING_MODEL_ID = "fake-embedding";
const EMBEDDING_DIMENSIONS = 3;

/** A complete gateway config on fresh in-memory adapters; no provider credentials. */
export const makeGatewayConfig = (): IAIGatewayConfig => ({
  modelRegistry: {repository: new InMemoryModelRegistryRepository()},
  aiProfileStore: {repository: new InMemoryAIProfileRepository()},
  promptTemplateStore: {repository: new InMemoryPromptTemplateRepository()},
  threadStore: {repository: new InMemoryThreadRepository()},
  fileStore: {
    adapter: new InMemoryBlobAdapter(),
    path: "test/ai-files",
  },
  // Memory is off: a test that wants it switches it on
  workingMemory: {enabled: false},
  userMemoryStore: {
    repository: new InMemoryUserMemoryRepository(),
    enabled: false,
  },
  embedder: {
    embeddingModelId: EMBEDDING_MODEL_ID,
    dimensions: EMBEDDING_DIMENSIONS,
  },
  vectorStore: {
    adapter: new InMemoryVectorIndexAdapter({
      embeddingModelId: EMBEDDING_MODEL_ID,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  },
  queryRewriter: {enabled: false},
  runStore: {repository: new InMemoryRunRepository()},
  humanGate: {userQuestions: {enabled: false}},
  usageGuard: {adapter: new InMemoryUsageAdapter()},
  llmClient: {providers: {}},
  contextAssembler: {
    promptCaching: true,
    sharePromptCacheAcrossTenants: false,
  },
  trace: {repository: new InMemoryTraceRepository()},
  defaultCheapModelId: "fake-cheap",
});
