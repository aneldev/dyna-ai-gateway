import {
  IAIGatewayConfig,
  IAIProfile,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {
  escalationSkill,
  refundPolicySkill,
} from "../internal/samples/skills";
import {refundTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The profile a run starts on: the refund tool (pauses at 100 and above) and the refund-policy skill. */
export const refundPolicyProfile: IAIProfile = {
  ...sampleProfile,
  allowedTools: [refundTool.name],
  skills: [refundPolicySkill],
};

/** The profile a paused run may resume on (D65): the same tool, another skill. */
export const escalationProfile: IAIProfile = {
  ...refundPolicyProfile,
  id: "escalation",
  name: "Escalation",
  skills: [escalationSkill],
};

/** A profile with the tool and no skills: a run on it has no `load_skill` to rebuild. */
export const noSkillsProfile: IAIProfile = {
  ...sampleProfile,
  id: "no-skills",
  name: "No skills",
  allowedTools: [refundTool.name],
};

/** Three profiles on one tool: a run paused on the refund resumes with its skills, on its profile or on another (D124). */
export const gatewayConfigSkillsResume: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {repository: new InMemoryAIProfileRepository({profiles: [refundPolicyProfile, escalationProfile, noSkillsProfile]})},
  toolRegistry: {tools: [refundTool]},
};
