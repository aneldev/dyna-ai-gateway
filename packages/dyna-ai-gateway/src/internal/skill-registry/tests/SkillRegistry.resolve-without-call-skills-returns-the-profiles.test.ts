import {SkillRegistry} from "../SkillRegistry";

import {
  makeProfileWithSkills,
  makeSkill,
} from "./utils/skillFixtures";

/** `upsertProfile` validates a profile alone: no call skills given, the profile's come back; nothing for a profile without the key. */
test("resolve without call skills returns the profile's skills, and [] when there are none", () => {
  const registry = new SkillRegistry();

  expect(registry.resolve({profile: makeProfileWithSkills([makeSkill("refund_policy")])}).map(skill => skill.name)).toEqual(["refund_policy"]);
  expect(registry.resolve({profile: makeProfileWithSkills()})).toEqual([]);
});
