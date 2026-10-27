import {ToolPolicy} from "../ToolPolicy";
import {IResolvedTools} from "../types";
import {
  allTools,
  makeCaps,
  makeProfile,
  makeTerminalTool,
  makeUserContext,
} from "./utils/toolPolicyFixtures";

const resolveWith = (tool = makeTerminalTool("handover", true)): IResolvedTools =>
  new ToolPolicy({}).resolve({
    allTools: [...allTools, tool],
    profile: makeProfile(["get_invoice", "handover"]),
    userContext: makeUserContext(),
    caps: makeCaps(),
  });

const endsRun = (name: string, resolved: IResolvedTools, output: unknown = {status: "accepted"}, input: unknown = {reason: "asked"}): Promise<boolean> =>
  new ToolPolicy({}).endsRun({
    name,
    input,
    output,
    userContext: makeUserContext(),
    resolved,
  });


describe("ToolPolicy.endsRun", () => {
  test("a tool with endsRun: true ends the run after every call", async () => {
    await expect(endsRun("handover", resolveWith())).resolves.toBe(true);
  });
});
