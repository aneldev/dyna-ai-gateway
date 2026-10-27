import {MockLanguageModelV4} from "ai/test";

import {
  InMemoryModelRegistryRepository,
  InMemoryTraceRepository,
  InMemoryUsageAdapter,
} from "../../../../adapters/in-memory";

import {EPartKind} from "../../../../contracts";

import {
  IModelInfo,
  ModelRegistry,
  EModelProvider,
} from "../../../model-registry";
import {UsageGuard} from "../../../usage-guard";
import {
  Trace,
  ETraceKind,
} from "../../../trace";

import {LLMClient} from "../../LLMClient";
import {
  ILLMClientConfig,
  IModelRequest,
  EMessageRole,
} from "../../types";

export const makeModel = (
  id: string,
  provider: EModelProvider,
  providerModelId = `${id}-provider`,
): IModelInfo => ({
  id,
  provider,
  providerModelId,
  label: id,
  caps: {
    tools: true,
    images: false,
    pdf: false,
    structuredOutput: true,
    reasoning: false,
    temperature: true,
    embeddings: false,
    contextTokens: 128_000,
    maxOutputTokens: 4_000,
    costInPerMTokUsd: 1,
    costOutPerMTokUsd: 2,
  },
  enabled: true,
  deprecatedAt: null,
});

export interface ILLMClientSetup {
  client: LLMClient;
  trace: Trace;
  /** The usage adapter behind the client's UsageGuard: what the client asked and reported. */
  usageAdapter: InMemoryUsageAdapter;
}

/** An LLMClient over an in-memory registry holding the given models, with the trace and the usage adapter it reports to. */
export const makeLLMClientSetup = async (
  models: IModelInfo[],
  config: ILLMClientConfig,
  /** The usage adapter of the setup; default approves everything. */
  usageAdapter = new InMemoryUsageAdapter(),
): Promise<ILLMClientSetup> => {
  const repository = new InMemoryModelRegistryRepository();
  for (const model of models) await repository.save({model});
  const modelRegistry = new ModelRegistry({repository});
  const trace = new Trace({repository: new InMemoryTraceRepository()});
  return {
    client: new LLMClient(config, {
      modelRegistry,
      usageGuard: new UsageGuard({adapter: usageAdapter}),
      trace,
    }),
    trace,
    usageAdapter,
  };
};

/** An LLMClient over an in-memory registry holding the given models. */
export const makeLLMClient = async (models: IModelInfo[], config: ILLMClientConfig): Promise<LLMClient> =>
  (await makeLLMClientSetup(models, config)).client;

export const makeRequest = (overrides: Partial<IModelRequest> = {}): IModelRequest => ({
  modelId: "model-a",
  system: "You are a test",
  messages: [
    {
      role: EMessageRole.USER,
      parts: [
        {
          kind: EPartKind.TEXT,
          text: "hi",
        },
      ],
    },
  ],
  maxOutputTokens: 500,
  ...overrides,
});

export const meta = {
  tenantId: "tenant-a",
  kind: ETraceKind.CHAT,
};

/** The output of the first tool result in a prompt the model received, or undefined. */
export const findToolOutput = (prompt: MockLanguageModelV4["doStreamCalls"][number]["prompt"]): unknown => {
  const toolMessage = prompt.find(message => message.role === "tool");
  const part = toolMessage?.role === "tool" ? toolMessage.content[0] : undefined;
  return part?.type === "tool-result" ? part.output : undefined;
};
