# Installation

```bash
pnpm add dyna-ai-gateway zod
```

Node.js 24 or newer. `zod` 4 is a peer dependency: the tools and the structured answers are typed with it. The package is
server-only; never bundle it into a browser build.

## 1. The configuration

One object: the stores, the providers and the switches. The in-memory stores ship with the package; a database adapter
implements the same interface, so moving to production changes these lines and nothing else.

```ts
import {
  AIGateway,
  IAIGatewayConfig,
  EModelProvider,
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
} from "dyna-ai-gateway";

const config: IAIGatewayConfig = {
  llmClient: {providers: {[EModelProvider.OPENAI]: {apiKey: process.env.OPENAI_API_KEY ?? ""}}},
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [gpt61Terra, textEmbedding3Small]})},
  aiProfileStore: {repository: new InMemoryAIProfileRepository({profiles: [accountingProfile]})},
  promptTemplateStore: {repository: new InMemoryPromptTemplateRepository()},
  threadStore: {repository: new InMemoryThreadRepository()},
  fileStore: {adapter: new InMemoryBlobAdapter(), path: "ai-files"},
  workingMemory: {enabled: true},
  userMemoryStore: {repository: new InMemoryUserMemoryRepository(), enabled: true},
  embedder: {embeddingModelId: "text-embedding-3-small", dimensions: 1536},
  vectorStore: {adapter: new InMemoryVectorIndexAdapter({embeddingModelId: "text-embedding-3-small", dimensions: 1536})},
  queryRewriter: {enabled: true},
  runStore: {repository: new InMemoryRunRepository()},
  humanGate: {userQuestions: {enabled: true}},
  usageGuard: {adapter: new InMemoryUsageAdapter()},
  contextAssembler: {promptCaching: true, sharePromptCacheAcrossTenants: false},
  trace: {repository: new InMemoryTraceRepository()},
  defaultCheapModelId: "gpt-6.1-terra",
};

const gateway = new AIGateway(config);
```

The switches (`enabled`, `promptCaching`, `sharePromptCacheAcrossTenants`) are required on purpose: each one changes what
the model sees or what a tenant shares, so the configuration states it. `InMemoryUsageAdapter` allows every call; in
production your own usage adapter decides.

## 2. A model

A **model** (`IModelInfo`) is registered with its provider, its capabilities and its price. The gateway reads the
capabilities to decide what a call may send (tools, images, PDFs) and prices the usage with the costs.

```ts
import {IModelInfo, EModelProvider} from "dyna-ai-gateway";

const gpt61Terra: IModelInfo = {
  id: "gpt-6.1-terra",
  provider: EModelProvider.OPENAI,
  providerModelId: "gpt-6.1-terra",
  label: "GPT-6.1 Terra",
  caps: {
    tools: true,
    images: true,
    pdf: true,
    structuredOutput: true,
    reasoning: true,
    temperature: false,
    embeddings: false,
    contextTokens: 922_000, // OpenAI's input limit (the context window is 1 050 000)
    maxOutputTokens: 128_000,
    costInPerMTokUsd: 1,
    costOutPerMTokUsd: 5,
    costCacheReadPerMTokUsd: 0.05,
    costCacheWritePerMTokUsd: 1.25,
  },
  enabled: true,
  deprecatedAt: null,
};

const textEmbedding3Small: IModelInfo = {
  id: "text-embedding-3-small",
  provider: EModelProvider.OPENAI,
  providerModelId: "text-embedding-3-small",
  label: "text-embedding-3-small",
  caps: {
    tools: false,
    images: false,
    pdf: false,
    structuredOutput: false,
    reasoning: false,
    temperature: false,
    embeddings: true,
    contextTokens: 8_192,
    maxOutputTokens: 0,
    costInPerMTokUsd: 0.02,
    costOutPerMTokUsd: 0,
  },
  enabled: true,
  deprecatedAt: null,
};
```

The prices are the provider's list prices per million tokens; keep them current, the trace and the usage report use them.
A model holds one price: OpenAI bills `gpt-6.1-terra` at higher rates for a request above 272 000 input tokens, which
the registry does not price. `contextTokens` is the room of the request and its answer; `gpt-6.1-terra` takes at most
922 000 input tokens of its 1 050 000, so the entry gives that limit.

## 3. A profile

A **profile** (`IAIProfile`) is what a tenant's use case runs on: the model, the tools it may call, the approvals, a
prompt addendum and the limits. Each call names its profile, so one thread can switch model between two calls. Models
and profiles are data in a store and can be changed while the server runs.

```ts
import {IAIProfile} from "dyna-ai-gateway";

const accountingProfile: IAIProfile = {
  id: "accounting",
  tenantId: "acme",
  name: "Accounting assistant",
  modelId: "gpt-6.1-terra",
  promptAddendum: "You assist the accounting team of a Norwegian company. Amounts are in NOK.",
  allowedTools: ["get_invoice", "post_credit_note"],
  approvals: [],
  limits: {maxStepsPerRun: 6, maxOutputTokens: 2_000},
};
```

Next: [Example: ask](30-example-ask.md).
