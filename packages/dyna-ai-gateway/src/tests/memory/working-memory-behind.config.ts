import {IAIGatewayConfig} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Thread memory on, updated after every turn (the default); user memory off. */
export const gatewayConfigWorkingMemoryBehind: IAIGatewayConfig = {
  ...gatewayConfigBase,
  workingMemory: {enabled: true},
};
