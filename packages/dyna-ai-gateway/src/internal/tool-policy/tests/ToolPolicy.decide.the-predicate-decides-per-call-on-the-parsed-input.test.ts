import {
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../../../contracts";

import {
  decide,
  makePolicyTool,
  resolveWithTool,
} from "./utils/toolPolicyFixtures";

/** Small refunds run, large ones wait for a human with a text for the rejection, impossible ones are refused with a reason. */
const refundPolicy = ({input}: {input: {amount: number}}): TToolCallPolicyResult => {
  if (input.amount > 1_000) {
    return {
      verdict: EToolCallVerdict.DENY,
      reason: `${input.amount} is above the charge of 1000.`,
    };
  }
  if (input.amount > 100) {
    return {
      verdict: EToolCallVerdict.NEEDS_APPROVAL,
      rejectionText: `The refund of ${input.amount} was declined.`,
    };
  }
  return {verdict: EToolCallVerdict.ALLOW};
};

describe("ToolPolicy.decide", () => {
  test("the predicate decides per call on the parsed input: allow, needs approval with its rejection text, deny with its reason", async () => {
    const resolved = resolveWithTool(makePolicyTool("refund_order", refundPolicy));
    await expect(decide("refund_order", resolved, {amount: 50})).resolves.toEqual({verdict: EToolCallVerdict.ALLOW});
    await expect(decide("refund_order", resolved, {amount: 500})).resolves.toEqual({
      verdict: EToolCallVerdict.NEEDS_APPROVAL,
      rejectionText: "The refund of 500 was declined.",
    });
    await expect(decide("refund_order", resolved, {amount: 5_000})).resolves.toEqual({
      verdict: EToolCallVerdict.DENY,
      reason: "5000 is above the charge of 1000.",
    });
  });
});
