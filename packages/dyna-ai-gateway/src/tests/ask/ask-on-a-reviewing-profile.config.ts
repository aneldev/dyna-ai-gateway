import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** A profile whose answers a human reviews (D99), on a plain chat: the door that cannot pause. */
export const gatewayConfigAskOnAReviewingProfile: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          reviewAnswers: true,
        },
      ],
    }),
  },
};
