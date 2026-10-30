import {SkillRegistry} from "../SkillRegistry";

import {makeSkill} from "./utils/skillFixtures";

/** The model can only ask for a skill of this call: the input schema is an enum of the given names, nothing else parses. */
test("makeLoadSkillTool's input accepts exactly the given skill names", () => {
  const tool = new SkillRegistry().makeLoadSkillTool({skills: [makeSkill("refund_policy"), makeSkill("escalation")]});

  expect([
    tool.inputSchema.safeParse({name: "refund_policy"}).success,
    tool.inputSchema.safeParse({name: "escalation"}).success,
    tool.inputSchema.safeParse({name: "export_wizard"}).success,
    tool.inputSchema.safeParse({name: "Refund_Policy"}).success,
    tool.inputSchema.safeParse({}).success,
  ]).toEqual([true, true, false, false, false]);
});
