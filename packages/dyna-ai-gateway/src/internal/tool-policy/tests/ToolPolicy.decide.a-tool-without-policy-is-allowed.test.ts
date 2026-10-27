import {EToolCallVerdict} from "../../../contracts";

import {
  decide,
  makeTool,
  resolveWithTool,
} from "./utils/toolPolicyFixtures";

describe("ToolPolicy.decide", () => {
  test("a tool without policy is allowed: the call runs without a human", async () => {
    const resolved = resolveWithTool(makeTool("lookup"));
    await expect(decide("lookup", resolved, {id: "1"})).resolves.toEqual({verdict: EToolCallVerdict.ALLOW});
  });
});
