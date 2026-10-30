import {SkillRegistry} from "../SkillRegistry";

import {
  makeProfileWithSkills,
  makeSkill,
} from "./utils/skillFixtures";

/** The merged list keeps the order the model reads it in: the profile's skills, then the call's, unchanged. */
test("resolve lists the profile's skills before the call's, as given", () => {
  const registry = new SkillRegistry({});
  const profileSkills = [makeSkill("refund_policy"), makeSkill("escalation")];
  const skills = [makeSkill("export_wizard")];

  const resolved = registry.resolve({
    profile: makeProfileWithSkills(profileSkills),
    skills,
  });

  expect(resolved.map(skill => skill.name)).toEqual(["refund_policy", "escalation", "export_wizard"]);
  expect(resolved[0]).toEqual(profileSkills[0]);
});
