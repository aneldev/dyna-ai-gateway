import {
  IAIGatewayConfig,
  InMemoryUserMemoryRepository,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** User memory on with its defaults: the memory tools are offered, `dyna_aigw_remember_user_fact` waits for approval. */
export const gatewayConfigRememberUserFact: IAIGatewayConfig = {
  ...gatewayConfigBase,
  userMemoryStore: {
    repository: new InMemoryUserMemoryRepository(),
    enabled: true,
  },
};
