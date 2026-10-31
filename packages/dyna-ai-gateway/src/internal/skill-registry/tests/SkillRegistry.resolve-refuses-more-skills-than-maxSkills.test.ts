import {SkillRegistry} from "../SkillRegistry";

import {
  makeProfileWithSkills,
  makeSkill,
} from "./utils/skillFixtures";

/** The cap counts the profile's and the call's skills together: one over `maxSkills` is a 400 naming the cap and the count. */
test("resolve refuses more skills than maxSkills, the profile's and the call's together, with a 400 naming the cap and the count", () => {
  const registry = new SkillRegistry({maxSkills: 2});

  const refused = (): unknown => registry.resolve({
    profile: makeProfileWithSkills([makeSkill("refund_policy"), makeSkill("escalation")]),
    skills: [makeSkill("export_wizard")],
  });

  expect(refused).toThrow(expect.objectContaining({
    status: 400,
    data: {
      maxSkills: 2,
      count: 3,
    },
  }));
});
