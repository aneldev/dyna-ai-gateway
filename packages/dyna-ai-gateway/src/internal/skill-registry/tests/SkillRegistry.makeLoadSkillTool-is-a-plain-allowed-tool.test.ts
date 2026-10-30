import {EToolCallVerdict} from "../../../contracts";

import {LOAD_SKILL_TOOL_NAME} from "../constants";
import {SkillRegistry} from "../SkillRegistry";

import {makeSkill} from "./utils/skillFixtures";

/** Loading instructions is harmless: the tool runs without approval, never ends the run and is offered on every step. */
test("makeLoadSkillTool is named load_skill, allowed, without endsRun or visibleWhen", () => {
  const tool = new SkillRegistry().makeLoadSkillTool({skills: [makeSkill("refund_policy")]});

  expect({
    name: tool.name,
    tags: tool.tags,
    policy: tool.policy,
    endsRun: tool.endsRun,
    visibleWhen: tool.visibleWhen,
  }).toEqual({
    name: LOAD_SKILL_TOOL_NAME,
    tags: ["skill"],
    policy: EToolCallVerdict.ALLOW,
    endsRun: undefined,
    visibleWhen: undefined,
  });
  expect(tool.description).toContain("Loads the full instructions");
});
