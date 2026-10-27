import {IAIGatewayConfig} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Plain chat, nothing switched on: the thread lease (D77) is in every call, the scenario needs no more. */
export const gatewayConfigThreadLease: IAIGatewayConfig = {...gatewayConfigBase};
