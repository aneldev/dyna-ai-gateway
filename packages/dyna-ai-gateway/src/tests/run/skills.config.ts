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

/** A profile with two skills (D124), no app tools: the only tool of a run is the built-in `load_skill`. */
export const gatewayConfigSkills: IAIGatewayConfig = {
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

/** The sample profile as it is, without skills: nothing may be listed and no tool offered. */
export const gatewayConfigNoSkills: IAIGatewayConfig = {...gatewayConfigBase};

/** The skills config with `maxSkills: 1`: the sample profile's two skills are one too many, so `upsertProfile` refuses it. */
export const gatewayConfigSkillsCaps: IAIGatewayConfig = {
  ...gatewayConfigSkills,
  skillRegistry: {maxSkills: 1},
};
