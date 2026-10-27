import {EToolCallVerdict} from "../../../contracts";

import {
  decide,
  makeTool,
  resolveWithTool,
} from "./utils/toolPolicyFixtures";

describe("ToolPolicy.decide", () => {
  test("policy: NEEDS_APPROVAL pauses every call, whatever the input", async () => {
    const resolved = resolveWithTool(makeTool("send_mail", EToolCallVerdict.NEEDS_APPROVAL));
    await expect(decide("send_mail", resolved, {id: "1"})).resolves.toEqual({verdict: EToolCallVerdict.NEEDS_APPROVAL});
  });
});
