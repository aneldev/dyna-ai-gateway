import {EToolCallVerdict} from "../../../contracts";

import {
  decide,
  makeGuardedTool,
  resolveWithTool,
} from "./utils/toolPolicyFixtures";

describe("ToolPolicy.decide", () => {
  test("an async predicate (a lookup) is awaited", async () => {
    const resolved = resolveWithTool(makeGuardedTool("big_refund", 100, true));
    await expect(decide("big_refund", resolved, {amount: 500})).resolves.toEqual({verdict: EToolCallVerdict.NEEDS_APPROVAL});
  });
});
