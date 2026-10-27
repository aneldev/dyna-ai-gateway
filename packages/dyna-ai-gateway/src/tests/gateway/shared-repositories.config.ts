import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/**
 * One config, two gateways: the repositories are instances inside it, so every gateway built on it shares the threads, runs
 * and traces. Refund pauses at 100 and above.
 */
export const gatewayConfigSharedRepositories: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [refundTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [refundTool]},
};
