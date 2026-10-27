import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
} from "../..";

import {mistralModel} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The token the profile makes the model answer with; the test looks for it. */
export const MISTRAL_CHAT_TOKEN = "PONG-4440";

/** Plain chat on Mistral (`mistral-small`): the only registered model, the profile's model, the cheap model. */
export const gatewayConfigAskMistral: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [mistralModel]})},
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        modelId: mistralModel.id,
        promptAddendum: `You are a ping service. Whatever the user writes, answer with exactly this text and nothing else: ${MISTRAL_CHAT_TOKEN}`,
      }],
    }),
  },
  defaultCheapModelId: mistralModel.id,
};
