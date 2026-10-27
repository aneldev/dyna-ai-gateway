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
  test("the predicate decides per call on the output", async () => {
    const resolved = resolveWith(makeTerminalTool("handover", false));
    await expect(endsRun("handover", resolved, {status: "accepted"})).resolves.toBe(true);
    await expect(endsRun("handover", resolved, {status: "queued"})).resolves.toBe(false);
  });
});
