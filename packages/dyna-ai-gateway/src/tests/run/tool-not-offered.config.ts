import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {
  getCurrentTimeTool,
  sendEmailTool,
} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Registry: the time tool and send_email; the profile allows the time tool only, so send_email is never offered to the model. */
export const gatewayConfigToolNotOffered: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [getCurrentTimeTool.name],
        },
      ],
    }),
  },
  toolRegistry: {
    tools: [
      getCurrentTimeTool,
      sendEmailTool,
    ],
  },
};
