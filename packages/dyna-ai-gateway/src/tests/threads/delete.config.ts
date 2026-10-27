import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  InMemoryUserMemoryRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {sendEmailTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/**
 * Chat with `send_email` (pauses for approval) and user memory extracted after every answer: the scenario of the bulk
 * `delete` — threads with turns, files, a paused run, trace entries and a background memory job.
 */
export const gatewayConfigDelete: IAIGatewayConfig = {
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
  userMemoryStore: {
    repository: new InMemoryUserMemoryRepository(),
    enabled: true,
    extractEveryTurns: 1,
  },
};
