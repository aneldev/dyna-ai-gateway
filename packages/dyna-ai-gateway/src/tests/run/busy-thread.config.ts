import {
  IAIGatewayConfig,
  InMemoryThreadRepository,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Plain chat on its own thread repository, so the test can hold a lease on a thread as another call would. */
export const gatewayConfigBusyThread: IAIGatewayConfig = {
  ...gatewayConfigBase,
  threadStore: {repository: new InMemoryThreadRepository()},
};
