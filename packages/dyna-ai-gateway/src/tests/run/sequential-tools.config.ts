import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {
  getCurrentTimeTool,
  refundTool,
} from "../internal/samples/tools";

import {
  gatewayConfigParallelTools,
  lookupOrderTool,
} from "./parallel-tools.config";

/** The tools of `gatewayConfigParallelTools` on a profile that runs the calls of a step one after the other (`parallelToolCalls: false`, D101). */
export const gatewayConfigSequentialTools: IAIGatewayConfig = {
  ...gatewayConfigParallelTools,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [getCurrentTimeTool.name, lookupOrderTool.name, refundTool.name],
          parallelToolCalls: false,
        },
      ],
    }),
  },
};
