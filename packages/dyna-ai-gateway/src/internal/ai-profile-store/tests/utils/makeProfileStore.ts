import {
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
  InMemoryRunRepository,
} from "../../../../adapters/in-memory";

import {
  IModelInfo,
  ModelRegistry,
  EModelProvider,
} from "../../../model-registry";
import {
  IRun,
  RunStore,
} from "../../../run-store";
import {ToolRegistry} from "../../../tool-registry";

import {AIProfileStore} from "../../AIProfileStore";
import {IAIProfile} from "../../types";

const modelA: IModelInfo = {
  id: "model-a",
  provider: EModelProvider.OPENAI,
  providerModelId: "model-a-2026",
  label: "model-a",
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
};

/** A profile of `tenantId` on `model-a`, no tools. */
export const makeProfile = (tenantId: string, id: string): IAIProfile => ({
  id,
  tenantId,
  name: id,
  modelId: modelA.id,
  allowedTools: [],
  approvals: [],
  promptAddendum: "",
  limits: {
    maxStepsPerRun: 5,
    maxOutputTokens: 500,
  },
});

/** A store on in-memory repositories seeded with `profiles` and `runs`; the model registry knows `model-a` only. */
export const makeProfileStore = async (
  {
    profiles = [],
    runs = [],
  }: {
    profiles?: IAIProfile[];
    runs?: IRun[];
  } = {},
): Promise<{store: AIProfileStore; repository: InMemoryAIProfileRepository}> => {
  const repository = new InMemoryAIProfileRepository({profiles});
  const runRepository = new InMemoryRunRepository();
  for (const run of runs) await runRepository.save({run});
  const store = new AIProfileStore({repository}, {
    modelRegistry: new ModelRegistry({repository: new InMemoryModelRegistryRepository({models: [modelA]})}),
    toolRegistry: new ToolRegistry({tools: []}),
    runStore: new RunStore({repository: runRepository}),
  });
  return {
    store,
    repository,
  };
};
