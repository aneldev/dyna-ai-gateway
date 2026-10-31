import {SkillRegistry} from "../SkillRegistry";

import {
  makeProfileWithSkills,
  makeSkill,
} from "./utils/skillFixtures";

/** The call wins nothing over the profile: the same name in both is a 400 that names it, before anything is stored. */
test("resolve refuses a skill name present in the profile and in the call with a 400 naming the duplicate", () => {
  const registry = new SkillRegistry();

  const refused = (): unknown => registry.resolve({
    profile: makeProfileWithSkills([makeSkill("refund_policy")]),
    skills: [makeSkill("refund_policy", {body: "The call's version."})],
  });

  expect(refused).toThrow(expect.objectContaining({
    code: 5380126731579,
    status: 400,
    data: {
      duplicates: ["refund_policy"],
      emptyNames: 0,
    },
  }));
});
