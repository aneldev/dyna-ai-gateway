import {
  IAIGatewayConfig,
  InMemoryBlobAdapter,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/**
 * The base config with an empty file path, so a key is `[<tenantId>]/<userId>/<fileId>` and an empty tenant's
 * `/<userId>/<fileId>` sits right next to the keys of a tenant named like its user.
 */
export const gatewayConfigEmptyTenantId: IAIGatewayConfig = {
  ...gatewayConfigBase,
  fileStore: {
    adapter: new InMemoryBlobAdapter(),
    path: "",
  },
};
