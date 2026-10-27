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
  test("a tool without endsRun never ends the run", async () => {
    await expect(endsRun("get_invoice", resolveWith(), "an invoice", {id: "1"})).resolves.toBe(false);
  });
});
