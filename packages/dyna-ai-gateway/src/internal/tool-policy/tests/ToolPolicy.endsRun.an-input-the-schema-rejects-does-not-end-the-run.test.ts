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
  test("an input the schema rejects does not end the run: the predicate is never called on an unparsed input", async () => {
    await expect(endsRun("handover", resolveWith(makeTerminalTool("handover", false)), {status: "accepted"}, {reason: 42})).resolves.toBe(false);
  });
});
