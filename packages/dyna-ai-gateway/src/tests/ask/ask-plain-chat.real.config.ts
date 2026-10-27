import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The token the profile makes the model answer with; the test looks for it. */
export const PLAIN_CHAT_TOKEN = "PONG-7731";

/** Plain chat on OpenAI (`gpt-5-mini`): no tools, no memory, no knowledge base. The profile leaves the model one answer. */
export const gatewayConfigAskPlainChat: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        promptAddendum: `You are a ping service. Whatever the user writes, answer with exactly this text and nothing else: ${PLAIN_CHAT_TOKEN}`,
      }],
    }),
  },
};
