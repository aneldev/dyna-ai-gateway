import {IAIGatewayConfig} from "../..";

import {refundTool} from "../internal/samples/tools";

import {
  gatewayConfigParallelTools,
  lookupOrderTool,
} from "./parallel-tools.config";

/** The parallel-tools scenario with a guarded workflow (D15): refund is offered only after lookup_order ran in the run. */
export const gatewayConfigGuardedTools: IAIGatewayConfig = {
  ...gatewayConfigParallelTools,
  toolPolicy: {requires: {[refundTool.name]: [lookupOrderTool.name]}},
};
