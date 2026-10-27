import {EToolCallVerdict} from "../../../contracts";

import {
  decide,
  makePolicyTool,
  resolveWithTool,
} from "./utils/toolPolicyFixtures";

describe("ToolPolicy.decide", () => {
  test("a denial wins over the profile's approvals: a human is never asked to approve a call that would be refused", async () => {
    const tool = makePolicyTool("refund_order", () => ({
      verdict: EToolCallVerdict.DENY,
      reason: "No such charge.",
    }));
    const resolved = resolveWithTool(tool, ["refund_order"]);
    await expect(decide("refund_order", resolved, {amount: 5})).resolves.toEqual({
      verdict: EToolCallVerdict.DENY,
      reason: "No such charge.",
    });
  });
});
