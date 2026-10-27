import {ToolPolicy} from "../ToolPolicy";
import {IResolvedTools} from "../types";
import {
  allTools,
  makeCaps,
  makeProfile,
  makeTerminalTool,
  makeUserContext,
} from "./utils/toolPolicyFixtures";

const endsRun = (name: string, resolved: IResolvedTools, output: unknown = {status: "accepted"}, input: unknown = {reason: "asked"}): Promise<boolean> =>
  new ToolPolicy({}).endsRun({
    name,
    input,
    output,
    userContext: makeUserContext(),
    resolved,
  });


describe("ToolPolicy.endsRun", () => {
  test("a tool the run does not offer does not end the run, whatever its definition says", async () => {
    const resolved = new ToolPolicy({}).resolve({
      allTools: [...allTools, makeTerminalTool("handover", true)],
      profile: makeProfile(["get_invoice"]),
      userContext: makeUserContext(),
      caps: makeCaps(),
    });
    await expect(endsRun("handover", resolved)).resolves.toBe(false);
  });
});
