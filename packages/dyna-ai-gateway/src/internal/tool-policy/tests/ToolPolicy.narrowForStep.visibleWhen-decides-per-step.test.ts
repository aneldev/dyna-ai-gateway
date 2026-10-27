import {z} from "zod";

import {IToolDef} from "../../../contracts";

import {defineTool} from "../../tool-registry";

import {ToolPolicy} from "../ToolPolicy";
import {IResolvedTools} from "../types";
import {
  allTools,
  makeCaps,
  makeProfile,
  makeUserContext,
} from "./utils/toolPolicyFixtures";

/** Offered on the first step only (D89). */
const classifyIntentTool: IToolDef = defineTool({
  name: "classify_intent",
  description: "Classifies the request.",
  inputSchema: z.object({intent: z.string()}),
  tags: [],
  visibleWhen: ({stepIndex}): boolean => stepIndex === 0,
  execute: async ({input: {intent}}): Promise<string> => intent,
});

const resolved: IResolvedTools = new ToolPolicy({}).resolve({
  allTools: [...allTools, classifyIntentTool],
  profile: makeProfile(["get_invoice", "classify_intent"]),
  userContext: makeUserContext(),
  caps: makeCaps(),
});

const namesOfStep = (stepIndex: number, executed: string[]): string[] =>
  new ToolPolicy({}).narrowForStep({
    resolved,
    executed,
    stepIndex,
  }).tools.map(tool => tool.name);

/** A tool with `visibleWhen` is offered only in the steps its predicate accepts; a tool without it is offered in every step. */
test("visibleWhen decides per step which tools the model is offered", () => {
  expect([
    namesOfStep(0, []),
    namesOfStep(1, ["classify_intent"]),
  ]).toEqual([
    ["get_invoice", "classify_intent"],
    ["get_invoice"],
  ]);
});
