import {EToolCallVerdict} from "../../../contracts";

import {
  decide,
  makeGuardedTool,
  resolveWithTool,
} from "./utils/toolPolicyFixtures";

describe("ToolPolicy.decide", () => {
  test("a built-in tool pauses through its own policy although the profile's approvals do not apply to it (ask_user_question, D62)", async () => {
    const askUser = makeGuardedTool("ask_user_question", 0);
    const resolved = resolveWithTool(askUser, ["ask_user_question"], ["ask_user_question"]);
    expect(resolved.approvals.has("ask_user_question")).toBe(false);
    await expect(decide("ask_user_question", resolved, {amount: 1})).resolves.toEqual({verdict: EToolCallVerdict.NEEDS_APPROVAL});
  });
});
