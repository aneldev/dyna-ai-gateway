import {SkillRegistry} from "../SkillRegistry";

import {
  makeProfileWithSkills,
  makeSkill,
} from "./utils/skillFixtures";

/** Uniqueness is by exact match within one list too; a name differing in case is another name. */
test("resolve refuses a name that appears twice within the call's skills; a different case is a different name", () => {
  const registry = new SkillRegistry({});

  const refused = (): unknown => registry.resolve({
    profile: makeProfileWithSkills(),
    skills: [makeSkill("export_wizard"), makeSkill("Export_Wizard"), makeSkill("export_wizard")],
  });

  expect(refused).toThrow(expect.objectContaining({
    status: 400,
    data: {
      duplicates: ["export_wizard"],
      emptyNames: 0,
    },
  }));
  expect(registry.resolve({
    profile: makeProfileWithSkills(),
    skills: [makeSkill("export_wizard"), makeSkill("Export_Wizard")],
  })).toHaveLength(2);
});
