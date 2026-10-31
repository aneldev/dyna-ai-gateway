import {SkillRegistry} from "../SkillRegistry";

import {
  makeProfileWithSkills,
  makeSkill,
} from "./utils/skillFixtures";

/** A body longer than `maxBodyChars` is a 400 naming the skill, its length and the cap; the other skills are not blamed. */
test("resolve refuses a skill whose body is over maxBodyChars with a 400 naming the skill and the length", () => {
  const registry = new SkillRegistry({maxBodyChars: 100});

  const refused = (): unknown => registry.resolve({
    profile: makeProfileWithSkills([makeSkill("refund_policy")]),
    skills: [makeSkill("export_wizard", {body: "x".repeat(101)})],
  });

  expect(refused).toThrow(expect.objectContaining({
    status: 400,
    data: {
      maxBodyChars: 100,
      skill: "export_wizard",
      length: 101,
    },
  }));
});
