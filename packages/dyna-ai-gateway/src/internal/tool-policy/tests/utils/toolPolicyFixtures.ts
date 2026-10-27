import {z} from "zod";

import {
  EToolCallVerdict,
  IToolDef,
  IUserContext,
  TToolCallPolicyHandler,
  TToolCallPolicyResult,
} from "../../../../contracts";

import {IModelCaps} from "../../../model-registry";
import {IAIProfile} from "../../../ai-profile-store";
import {defineTool} from "../../../tool-registry";

import {ToolPolicy} from "../../ToolPolicy";
import {IResolvedTools} from "../../types";

/** A tool on `{id}` with a static `policy`, or none. */
export const makeTool = (name: string, policy?: EToolCallVerdict): IToolDef =>
  defineTool({
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({id: z.string()}),
    tags: [],
    policy,
    execute: async (): Promise<string> => name,
  });

/** A tool that pauses only when `amount` reaches `threshold`; `async` makes the predicate return a promise. */
export const makeGuardedTool = (name: string, threshold: number, async = false): IToolDef =>
  makePolicyTool(name, ({input}) => {
    const result: TToolCallPolicyResult = {verdict: input.amount >= threshold ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW};
    return async ? Promise.resolve(result) : result;
  });

/** A tool on `{amount}` whose `policy` predicate is the given one. */
export const makePolicyTool = (name: string, policy: TToolCallPolicyHandler<{amount: number}>): IToolDef =>
  defineTool({
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({amount: z.number()}),
    tags: [],
    policy,
    execute: async (): Promise<string> => name,
  });

/** A tool that ends the run: always (`endsRun: true`) or only when its output says `accepted`; `async` makes the predicate return a promise. */
export const makeTerminalTool = (name: string, always: boolean, async = false): IToolDef =>
  defineTool({
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({reason: z.string()}),
    tags: [],
    endsRun: always
      ? true
      : ({output}): boolean | Promise<boolean> =>
        async ? Promise.resolve(output.status === "accepted") : output.status === "accepted",
    execute: async (): Promise<{status: string}> => ({status: "accepted"}),
  });

/** Get_invoice (runs directly), refund and send_email (policy: NEEDS_APPROVAL). */
export const allTools: IToolDef[] = [makeTool("get_invoice"), makeTool("refund", EToolCallVerdict.NEEDS_APPROVAL), makeTool("send_email", EToolCallVerdict.NEEDS_APPROVAL)];

export const makeProfile = (allowedTools: string[], approvals: string[] = []): IAIProfile => ({
  id: "careful",
  tenantId: "tenant-a",
  name: "Careful",
  modelId: "model-a",
  allowedTools,
  approvals,
  promptAddendum: "",
  limits: {
    maxStepsPerRun: 7,
    maxOutputTokens: 500,
  },
});

export const makeUserContext = (permissions: string[] = []): IUserContext => ({
  tenantId: "tenant-a",
  userId: "user-a",
  permissions,
  locale: "de-AT",
  timezone: "Europe/Vienna",
  now: new Date(1_000),
});

export const makeCaps = (tools = true): IModelCaps => ({
  tools,
  images: false,
  pdf: false,
  structuredOutput: true,
  reasoning: false,
  temperature: true,
  embeddings: false,
  contextTokens: 128_000,
  maxOutputTokens: 4_000,
  costInPerMTokUsd: 1,
  costOutPerMTokUsd: 2,
});

/** The run's set with `tool` next to `allTools`, allowed by name; `approvals` is the profile's list. */
export const resolveWithTool = (tool: IToolDef, approvals: string[] = [], builtInTools: string[] = []): IResolvedTools =>
  new ToolPolicy({}).resolve({
    allTools: [...allTools, tool],
    profile: makeProfile(["get_invoice", "refund", tool.name], approvals),
    userContext: makeUserContext(),
    caps: makeCaps(),
    builtInTools,
  });

/** The verdict of the policy on one call. */
export const decide = (name: string, resolved: IResolvedTools, input: unknown = {amount: 5}): Promise<TToolCallPolicyResult> =>
  new ToolPolicy({}).decide({
    name,
    input,
    userContext: makeUserContext(),
    resolved,
  });
