import {
  IAIGatewayConfig,
  InMemoryModelRegistryRepository,
} from "../..";

import {openAiModel} from "../internal/samples/models";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The base config on its own model repository, so the test may switch the sample model off without touching the shared one. */
export const gatewayConfigDisabledModel: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [openAiModel]})},
};
