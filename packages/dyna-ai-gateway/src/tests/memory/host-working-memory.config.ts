import {IAIGatewayConfig} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The base config: the built-in memory is off, a host memory passed in `overrides` replaces it anyway. */
export const gatewayConfigHostWorkingMemory: IAIGatewayConfig = {...gatewayConfigBase};
