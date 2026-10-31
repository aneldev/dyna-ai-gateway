import {SkillRegistry} from "../SkillRegistry";

import {makeSkill} from "./utils/skillFixtures";

/** A run offers `load_skill`: the slot names the skills and tells the model to load one, the bodies stay out of the prompt. */
test("renderSlot lists name and description, and points to load_skill, when not inline", () => {
  const registry = new SkillRegistry();

  // The bodies ("The instructions of …") must stay out: the model loads them with load_skill
  expect(registry.renderSlot({
    skills: [makeSkill("refund_policy"), makeSkill("escalation")],
    inline: false,
  })).toBe([
    "Skills — instructions you can load when a task needs them. Call load_skill with the name to read one; do not guess its content.",
    "- refund_policy: What refund_policy covers",
    "- escalation: What escalation covers",
  ].join("\n"));
});
