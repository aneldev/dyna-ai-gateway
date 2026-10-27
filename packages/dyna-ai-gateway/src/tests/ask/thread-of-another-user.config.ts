import {IAIGatewayConfig} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Plain chat, nothing switched on: two users of one tenant and one thread are all the scenario needs. */
export const gatewayConfigThreadOfAnotherUser: IAIGatewayConfig = {...gatewayConfigBase};
