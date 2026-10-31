import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {
  escalationSkill,
  refundPolicySkill,
} from "../internal/samples/skills";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** A profile with two skills (D124) for `ask()`: no tools, so the bodies go into the system prompt whole. */
export const gatewayConfigAskSkills: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        skills: [refundPolicySkill, escalationSkill],
      }],
    }),
  },
};
