import {IAIGatewayConfig} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The base config: the built-in memory is off, an application memory passed in `overrides` replaces it anyway. */
export const gatewayConfigApplicationWorkingMemory: IAIGatewayConfig = {...gatewayConfigBase};
