import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
} from "../..";

import {bedrockModel} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The token the profile makes the model answer with; the test looks for it. */
export const BEDROCK_CHAT_TOKEN = "PONG-4420";

/** Plain chat on Amazon Bedrock (`claude-haiku-4-5-bedrock`): the only registered model, the profile's model, the cheap model. */
export const gatewayConfigAskBedrock: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [bedrockModel]})},
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        modelId: bedrockModel.id,
        promptAddendum: `You are a ping service. Whatever the user writes, answer with exactly this text and nothing else: ${BEDROCK_CHAT_TOKEN}`,
      }],
    }),
  },
  defaultCheapModelId: bedrockModel.id,
};
