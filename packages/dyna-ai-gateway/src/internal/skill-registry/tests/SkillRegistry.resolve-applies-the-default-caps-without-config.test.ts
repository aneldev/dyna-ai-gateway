import {SkillRegistry} from "../SkillRegistry";

import {
  makeProfileWithSkills,
  makeSkill,
} from "./utils/skillFixtures";

/** Without a config the defaults hold: 50 skills with a 50 000-character body pass, the 51st skill and a 50 001-character body do not. */
test("resolve applies the default caps of 50 skills and 50 000 body characters without a config", () => {
  const registry = new SkillRegistry();
  const fifty = Array.from({length: 50}, (_, index) => makeSkill(`skill_${index}`, {body: "x".repeat(50_000)}));

  const atTheCaps = registry.resolve({profile: makeProfileWithSkills(fifty)});
  const oneSkillOver = (): unknown => registry.resolve({
    profile: makeProfileWithSkills(fifty),
    skills: [makeSkill("one_more")],
  });
  const oneCharOver = (): unknown => registry.resolve({profile: makeProfileWithSkills([makeSkill("long", {body: "x".repeat(50_001)})])});

  expect(atTheCaps.length).toBe(50);
  expect(oneSkillOver).toThrow(expect.objectContaining({data: expect.objectContaining({maxSkills: 50})}));
  expect(oneCharOver).toThrow(expect.objectContaining({data: expect.objectContaining({maxBodyChars: 50_000})}));
});
