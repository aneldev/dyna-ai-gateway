import {
  IAIGatewayConfig,
  IAIProfile,
  IModelInfo,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
  InMemoryThreadRepository,
  EWorkingMemoryStrategy,
} from "../..";

import {openAiModel} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The sample model with a window of 1 200 tokens: a few long turns fill it. */
export const smallWindowModel: IModelInfo = {
  ...openAiModel,
  id: "small-window",
  label: "Small window",
  caps: {
    ...openAiModel.caps,
    contextTokens: 1_200,
    maxOutputTokens: 100,
  },
};

/** The profile `small-window`: `default` on the small-window model. */
export const smallWindowProfile: IAIProfile = {
  ...sampleProfile,
  id: "small-window",
  modelId: smallWindowModel.id,
  limits: {
    ...sampleProfile.limits,
    maxOutputTokens: 100,
  },
};

/** The profile `summary`: `default` with its own strategy, SUMMARY_BUFFER, on a SLIDING_WINDOW gateway. */
export const summaryProfile: IAIProfile = {
  ...sampleProfile,
  id: "summary",
  workingMemory: {type: EWorkingMemoryStrategy.SUMMARY_BUFFER},
};

/** Thread memory on with the SLIDING_WINDOW strategy as the gateway's default; the profiles `default`, `small-window` and `summary`. */
export const gatewayConfigSlidingWindow: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [openAiModel, smallWindowModel]})},
  aiProfileStore: {repository: new InMemoryAIProfileRepository({profiles: [sampleProfile, smallWindowProfile, summaryProfile]})},
  threadStore: {repository: new InMemoryThreadRepository()},
  workingMemory: {
    enabled: true,
    strategy: {type: EWorkingMemoryStrategy.SLIDING_WINDOW},
  },
};
