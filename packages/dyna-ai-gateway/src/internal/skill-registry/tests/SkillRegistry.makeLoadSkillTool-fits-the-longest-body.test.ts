import {SkillRegistry} from "../SkillRegistry";

import {makeSkill} from "./utils/skillFixtures";

/**
 * The registry cuts a tool result above `maxOutputChars` (50 000 by default): a long skill body must not be cut, so the tool's
 * own cap is at least the serialised `{name, body}` of the longest skill.
 */
test("makeLoadSkillTool sizes maxOutputChars to the longest serialised {name, body}", () => {
  const long = makeSkill("long_one", {body: "x".repeat(60_000)});
  const tool = new SkillRegistry().makeLoadSkillTool({skills: [makeSkill("short_one"), long]});

  const serialised = JSON.stringify({
    name: long.name,
    body: long.body,
  }).length;
  expect(tool.maxOutputChars).toBeGreaterThanOrEqual(serialised);
  expect(tool.maxOutputChars).toBeGreaterThan(50_000);
});
