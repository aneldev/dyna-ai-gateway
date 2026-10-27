import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
} from "../..";

import {anthropicModel} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The token the profile makes the model answer with; the test looks for it. */
export const ANTHROPIC_CHAT_TOKEN = "PONG-4410";

/** Plain chat on Anthropic (`claude-haiku-4-5`): the only registered model, the profile's model, the cheap model. */
export const gatewayConfigAskAnthropic: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [anthropicModel]})},
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        modelId: anthropicModel.id,
        promptAddendum: `You are a ping service. Whatever the user writes, answer with exactly this text and nothing else: ${ANTHROPIC_CHAT_TOKEN}`,
      }],
    }),
  },
  defaultCheapModelId: anthropicModel.id,
};
