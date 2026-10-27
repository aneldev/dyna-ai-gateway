import {EToolCallVerdict} from "../../../contracts";

import {
  decide,
  makeTool,
  resolveWithTool,
} from "./utils/toolPolicyFixtures";

describe("ToolPolicy.decide", () => {
  test("policy: DENY refuses every call with a reason that names the tool (a kill switch)", async () => {
    const resolved = resolveWithTool(makeTool("legacy_export", EToolCallVerdict.DENY));
    const result = await decide("legacy_export", resolved, {id: "1"});
    expect(result.verdict).toBe(EToolCallVerdict.DENY);
    if (result.verdict !== EToolCallVerdict.DENY) throw new Error("expected a denial");
    expect(result.reason).toContain("legacy_export");
  });
});
