import {IAIGatewayConfig} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Plain chat on a model that reads images, the base file store: two users of one tenant and one uploaded file. */
export const gatewayConfigFileOfAnotherUser: IAIGatewayConfig = {...gatewayConfigBase};
