import {SkillRegistry} from "../SkillRegistry";

import {
  makeProfileWithSkills,
  makeSkill,
} from "./utils/skillFixtures";

/** A name the model cannot call by is refused: empty, or blanks only, counted in `data.emptyNames`. */
test("resolve refuses a skill whose name is empty after a trim with a 400 counting the empty names", () => {
  const registry = new SkillRegistry({});

  const refused = (): unknown => registry.resolve({
    profile: makeProfileWithSkills([makeSkill("   ")]),
    skills: [makeSkill("")],
  });

  expect(refused).toThrow(expect.objectContaining({
    status: 400,
    data: {
      duplicates: [],
      emptyNames: 2,
    },
  }));
});
