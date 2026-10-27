import {
  IAIGatewayConfig,
  InMemoryThreadRepository,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Plain chat on its own thread repository, so the test counts the threads a refused call left behind. */
export const gatewayConfigInvalidTimeout: IAIGatewayConfig = {
  ...gatewayConfigBase,
  threadStore: {repository: new InMemoryThreadRepository()},
};
