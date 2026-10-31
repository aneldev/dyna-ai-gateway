import {AIGateway} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {
  escalationSkill,
  refundPolicySkill,
} from "../internal/samples/skills";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSkillsCaps} from "./skills.config";

/** `IAIGatewayConfig.skillRegistry.maxSkills` reaches `upsertProfile`: a profile with more skills than the cap is a 400 and is not stored. */
test("a profile with more skills than maxSkills is refused at upsertProfile with a 400 naming the cap", async () => {
  const gateway = new AIGateway(gatewayConfigSkillsCaps);

  const upsert = gateway.aiProfileStore.upsertProfile({
    tenantId: sampleUserContext.tenantId,
    profile: {
      ...sampleProfile,
      id: "two-skills",
      skills: [refundPolicySkill, escalationSkill],
    },
  });

  await expect(upsert).rejects.toEqual(expect.objectContaining({
    status: 400,
    data: {
      maxSkills: 1,
      count: 2,
    },
  }));
  await expect(gateway.aiProfileStore.listProfiles({tenantId: sampleUserContext.tenantId})).resolves.toHaveLength(1);
});
