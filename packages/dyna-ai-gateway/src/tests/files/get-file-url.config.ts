import {IAIGatewayConfig} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The base file store (the in-memory blob adapter, whose signed URLs are `in-memory://<key>?ttlSec=<n>`). */
export const gatewayConfigGetFileUrl: IAIGatewayConfig = {...gatewayConfigBase};
