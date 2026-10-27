import {IAIGatewayConfig} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Plain chat on the base config: one model, the sample profile, in-memory trace; what the trace tests read back. */
export const gatewayConfigTrace: IAIGatewayConfig = {
  ...gatewayConfigBase,
};
