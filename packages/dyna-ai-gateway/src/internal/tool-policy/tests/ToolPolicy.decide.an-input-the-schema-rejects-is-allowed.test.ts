import {EToolCallVerdict} from "../../../contracts";

import {
  decide,
  makeGuardedTool,
  resolveWithTool,
} from "./utils/toolPolicyFixtures";

describe("ToolPolicy.decide", () => {
  test("an input the schema rejects never reaches the predicate: ALLOW, so that execute reports the invalid input to the model", async () => {
    const resolved = resolveWithTool(makeGuardedTool("big_refund", 0));
    await expect(decide("big_refund", resolved, {amount: "many"})).resolves.toEqual({verdict: EToolCallVerdict.ALLOW});
  });
});
