import {IAIGatewayConfig} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Plain chat; the test scripts a model answer that takes long, so the abort lands during the model call. */
export const gatewayConfigSlowModel: IAIGatewayConfig = {...gatewayConfigBase};
