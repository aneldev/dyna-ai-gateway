import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The profile's addendum; the test checks the order: addendum, then the call's instructions, then its context. */
export const CALL_LAYERS_ADDENDUM = "You are the assistant of the Nordwind invoicing app.";

/** Plain chat with a profile addendum; the call adds `instructions` and `context` (D68). */
export const gatewayConfigCallInstructionsAndContext: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        promptAddendum: CALL_LAYERS_ADDENDUM,
      }],
    }),
  },
};
