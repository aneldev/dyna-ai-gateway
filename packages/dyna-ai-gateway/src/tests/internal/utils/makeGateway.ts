import {
  IAIProfile,
  IChunkFilters,
  IAIGatewayConfig,
  IModelResult,
  IUserContext,
  AIGateway,
  InMemoryUsageAdapter,
  EFinishReason,
  EModelProvider,
} from "../../..";

import {FakeLLMClient} from "../fakes/FakeLLMClient";

import {makeGatewayConfig} from "./makeGatewayConfig";

export const userContext: IUserContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  permissions: [],
  locale: "de-AT",
  timezone: "Europe/Vienna",
  now: new Date("2026-10-01T10:00:00Z"),
};

/** The KB scope of a call that does not use the knowledge base. */
export const noKb: IChunkFilters = {
  libraryIds: [],
  bookIds: [],
};

export const makeProfile = (id: string, overrides: Partial<IAIProfile> = {}): IAIProfile => ({
  id,
  tenantId: "tenant-a",
  name: id,
  modelId: "model-a",
  allowedTools: [],
  approvals: [],
  promptAddendum: "Always mention the invoice number.",
  limits: {
    maxStepsPerRun: 5,
    maxOutputTokens: 500,
  },
  ...overrides,
});

export const makeModelResult = (overrides: Partial<IModelResult> = {}): IModelResult => ({
  modelId: "model-a",
  text: "The answer",
  toolCalls: [],
  finishReason: EFinishReason.STOP,
  usage: {
    inputTokens: 10,
    outputTokens: 2,
  },
  latencyMs: 5,
  traceId: "trace-1",
  ...overrides,
});

export interface IGatewaySetup {
  gateway: AIGateway;
  llmClient: FakeLLMClient;
  config: IAIGatewayConfig;
  /** The usage adapter of the config: what the gateway asked and reported. */
  usageAdapter: InMemoryUsageAdapter;
}

/**
 * A gateway on in-memory adapters and a FakeLLMClient, with the models "model-a" and "model-b"
 * and tenant-a's profiles "default" (model-a) and "other" (model-b).
 */
export const makeGateway = async (
  configOverrides: Partial<IAIGatewayConfig> = {},
  /** Tools the "default" profile allows; they must be in configOverrides.toolRegistry. */
  allowedTools: string[] = [],
): Promise<IGatewaySetup> => {
  const usageAdapter = new InMemoryUsageAdapter();
  const config: IAIGatewayConfig = {
    ...makeGatewayConfig(),
    usageGuard: {adapter: usageAdapter},
    ...configOverrides,
  };
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(config, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  for (const id of ["model-a", "model-b"]) {
    await gateway.modelRegistry.upsertModel({
      model: {
        id,
        provider: EModelProvider.OPENAI,
        providerModelId: `${id}-provider`,
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
      },
    });
  }
  const profiles = [
    makeProfile("default", {allowedTools}),
    makeProfile("other", {modelId: "model-b"}),
  ];
  for (const profile of profiles) {
    await gateway.aiProfileStore.upsertProfile({
      tenantId: "tenant-a",
      profile,
    });
  }

  return {
    gateway,
    llmClient,
    config,
    usageAdapter,
  };
};
