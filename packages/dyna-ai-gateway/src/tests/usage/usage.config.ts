import {
  IAIGatewayConfig,
  InMemoryUsageAdapter,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The usage adapter of the config: the tests read back what the gateway asked and reported. */
export const usageAdapter = new InMemoryUsageAdapter();

/** Plain chat with the thread memory on: an ask makes the main call and one MEMORY_WORKING helper call. */
export const gatewayConfigUsage: IAIGatewayConfig = {
  ...gatewayConfigBase,
  workingMemory: {enabled: true},
  usageGuard: {adapter: usageAdapter},
};
