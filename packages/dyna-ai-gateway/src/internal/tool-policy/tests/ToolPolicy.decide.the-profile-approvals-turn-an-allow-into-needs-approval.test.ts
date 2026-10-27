import {EToolCallVerdict} from "../../../contracts";

import {
  decide,
  makeGuardedTool,
  resolveWithTool,
} from "./utils/toolPolicyFixtures";

describe("ToolPolicy.decide", () => {
  test("the profile's approvals are the floor: a call the tool allows still pauses when the profile lists the tool", async () => {
    const resolved = resolveWithTool(makeGuardedTool("big_refund", 100), ["big_refund"]);
    await expect(decide("big_refund", resolved, {amount: 5})).resolves.toEqual({verdict: EToolCallVerdict.NEEDS_APPROVAL});
  });
});
