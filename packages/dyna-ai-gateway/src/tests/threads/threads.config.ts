import {
  IAIGatewayConfig,
  InMemoryThreadRepository,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The thread repository of the scenario, exported so a test can seed threads with the dates it needs. */
export const threadsRepository = new InMemoryThreadRepository();

/** Plain chat, nothing switched on: the thread methods of a chat screen need only threads and their turns. */
export const gatewayConfigThreads: IAIGatewayConfig = {
  ...gatewayConfigBase,
  threadStore: {repository: threadsRepository},
};
