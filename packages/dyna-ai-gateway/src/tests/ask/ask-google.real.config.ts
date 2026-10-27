import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
} from "../..";

import {googleModel} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The token the profile makes the model answer with; the test looks for it. */
export const GOOGLE_CHAT_TOKEN = "PONG-4430";

/** Plain chat on Google (`gemini-2.5-flash`): the only registered model, the profile's model, the cheap model. */
export const gatewayConfigAskGoogle: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [googleModel]})},
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        modelId: googleModel.id,
        promptAddendum: `You are a ping service. Whatever the user writes, answer with exactly this text and nothing else: ${GOOGLE_CHAT_TOKEN}`,
      }],
    }),
  },
  defaultCheapModelId: googleModel.id,
};
