import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  InMemoryUserMemoryRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/**
 * User memory on, the facts extracted every 2 turns, and the refund tool, which pauses for approval from 100 on: the scenario of
 * a run whose pause crosses an extraction boundary.
 */
export const gatewayConfigPausedRunMemory: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        allowedTools: [refundTool.name],
      }],
    }),
  },
  toolRegistry: {tools: [refundTool]},
  userMemoryStore: {
    repository: new InMemoryUserMemoryRepository(),
    enabled: true,
    extractEveryTurns: 2,
  },
};
