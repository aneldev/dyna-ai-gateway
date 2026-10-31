import {SkillRegistry} from "../SkillRegistry";

import {makeSkill} from "./utils/skillFixtures";

/** An ask has no tools, so the model cannot load anything: the slot carries every skill whole, one `## name` section each. */
test("renderSlot writes every body under a ## name heading when inline", () => {
  const registry = new SkillRegistry();

  // Nothing points to load_skill here: the model has no tool to call in an ask
  expect(registry.renderSlot({
    skills: [makeSkill("refund_policy"), makeSkill("escalation", {body: "  Escalate above 500.\n"})],
    inline: true,
  })).toBe([
    "Skills — instructions for this call:",
    "## refund_policy\n\n# refund_policy\n\nThe instructions of refund_policy.",
    "## escalation\n\nEscalate above 500.",
  ].join("\n\n"));
});
