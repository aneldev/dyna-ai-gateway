import {sampleUserContext} from "../../../tests/internal/utils/sampleUserContext";

import {SkillRegistry} from "../SkillRegistry";

import {makeSkill} from "./utils/skillFixtures";

/** The result is `{name, body}` of the named skill: the description is already in the prompt, so it is not repeated. */
test("makeLoadSkillTool's execute returns the name and the body of the named skill", async () => {
  const skills = [makeSkill("refund_policy"), makeSkill("escalation", {body: "Escalate above 500."})];
  const tool = new SkillRegistry().makeLoadSkillTool({skills});

  const result = await tool.execute({
    input: {name: "escalation"},
    userContext: sampleUserContext,
    threadId: "thread-1",
    abortSignal: new AbortController().signal,
  });

  expect(result).toEqual({
    name: "escalation",
    body: "Escalate above 500.",
  });
});
