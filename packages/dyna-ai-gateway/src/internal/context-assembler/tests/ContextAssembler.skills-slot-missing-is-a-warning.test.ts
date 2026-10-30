import {EIssueSeverity} from "../../../contracts";
import {joinSystem} from "../../llm-client";

import {makeSkill} from "../../skill-registry/tests/utils/skillFixtures";

import {
  makeAssembler,
  makeInput,
  makeMemory,
  makeTemplateStore,
} from "./utils/contextAssemblerFixtures";

/**
 * A tenant's stored CHAT_MAIN without `{skills}` drops the skills of the call: the render cannot place them. The template is
 * the admin's, so the call goes on and carries the WARNING `skills_slot_missing` naming the template version.
 */
test("a stored CHAT_MAIN without {skills} drops the skills and reports skills_slot_missing", async () => {
  const promptTemplateStore = await makeTemplateStore("{addendum}\n\n{cacheBreakpoint}\n\n{instructions}");

  const {
    request,
    issues,
  } = await makeAssembler({}, makeMemory(), promptTemplateStore).build({input: makeInput({skills: [makeSkill("refund_policy")]})});

  expect(joinSystem({blocks: request.system})).not.toContain("refund_policy");
  expect(issues.map(issue => [issue.code, issue.severity, issue.message.includes("version 1")])).toEqual([
    ["skills_slot_missing", EIssueSeverity.WARNING, true],
  ]);
});
