import {
  IAIGatewayConfig,
  InMemoryUserMemoryRepository,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** User memory on, extracted after every answer: a call leaves a background job that writes the user's facts. */
export const gatewayConfigErasure: IAIGatewayConfig = {
  ...gatewayConfigBase,
  userMemoryStore: {
    repository: new InMemoryUserMemoryRepository(),
    enabled: true,
    extractEveryTurns: 1,
  },
};
