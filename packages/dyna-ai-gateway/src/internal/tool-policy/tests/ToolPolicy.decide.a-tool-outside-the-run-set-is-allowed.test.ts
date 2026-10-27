import {EToolCallVerdict} from "../../../contracts";

import {
  decide,
  makeTool,
  resolveWithTool,
} from "./utils/toolPolicyFixtures";

describe("ToolPolicy.decide", () => {
  test("a tool outside the run's set is ALLOW here: ToolRegistry.execute refuses it (D72)", async () => {
    const resolved = resolveWithTool(makeTool("lookup"));
    await expect(decide("not_offered", resolved, {id: "1"})).resolves.toEqual({verdict: EToolCallVerdict.ALLOW});
  });
});
