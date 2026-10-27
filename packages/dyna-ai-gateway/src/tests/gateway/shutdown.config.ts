import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {sendEmailTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Plain chat plus `send_email`, which pauses for approval: the shutdown tests need a call in flight and a paused run. */
export const gatewayConfigShutdown: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        allowedTools: [sendEmailTool.name],
      }],
    }),
  },
  toolRegistry: {tools: [sendEmailTool]},
};
