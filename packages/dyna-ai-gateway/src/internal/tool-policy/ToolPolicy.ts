import {dynaError} from "dyna-error";

import {
  EToolCallVerdict,
  IToolDef,
  IUserContext,
  TToolCallPolicyResult,
} from "../../contracts";

import {IModelCaps} from "../model-registry";
import {IAIProfile} from "../ai-profile-store";
import {assertAppToolNames} from "../tool-registry";

import {
  IResolvedTools,
  IToolPolicy,
  IToolPolicyConfig,
} from "./types";

/**
 * ToolPolicy -- which tools a run may see, and the verdict on each call before it runs
 *
 * # About
 *
 * > The registry says what exists; the policy says what this user, this profile, this step and this call may use.
 *
 * Implements `IToolPolicy`: pure logic over the tool definitions, no I/O, no state beyond its config.
 *
 * - `resolve`, once per run: registry ∩ profile's `allowedTools` ∩ user's permissions ∩ model caps, narrowed to the
 *   call's `activeTools` (D48), the call's `additionalTools` added (D66), the built-ins always in (D61); with the set
 *   of tools that pause for a human (D87).
 * - `narrowForStep`, before every model step: guarded workflows (`requires`, D15) and each tool's `visibleWhen` (D89).
 * - `assertOfferedInStep`, before a call runs: a tool the step hid is refused with the reason (D88).
 * - `decide`, before a call runs: ALLOW, DENY with a reason, or NEEDS_APPROVAL, from the tool's `policy` and the
 *   profile's `approvals` (D87).
 * - `endsRun`, after a call ran: whether the result is the final answer (D86).
 *
 * It sits between the `ToolRegistry` (the catalog) and the agent loop (`runAgentLoop`), which asks it through the hooks
 * of `createRunHooks`.
 *
 * # Who needs it
 *
 * `prepareCall` and `AIGateway.resume` (`resolve`); `createRunHooks` for the loop's `prepareStep`, `executeTool`,
 * `decideToolCall` and `endsRun` hooks. A host replaces it with its own `IToolPolicy` in `overrides.toolPolicy`.
 *
 * # What needs
 *
 * Nothing shared: only its config (`permissionsToTools`, `requires`).
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, through the gateway: `createGatewayDeps` creates it from `IAIGatewayConfig.toolPolicy`.
 *
 * ## When shouldn't use it
 *
 * A host with its own authorisation model (roles, ABAC) implements `IToolPolicy` over it and passes it in `overrides`.
 *
 * # Pitfalls
 *
 * The policy never executes and never refuses a tool outside the run: `ToolRegistry.execute` does (D72). A rule here is
 * a rule on the model's tool calls only; the application's own calls to a tool do not pass through it.
 */
export class ToolPolicy implements IToolPolicy {
  constructor(private readonly config: IToolPolicyConfig) {
  }

  /**
   * resolve -- the tool set of one run
   *
   * # About
   *
   * > Everything the profile allows and the user may use, cut to what the call asked for; the built-ins always.
   *
   * The tools of `allTools` the profile allows and the user's permissions unlock, plus the call's `additionalTools`
   * (allowed because the app passed them, the permissions still apply, D66), narrowed to `activeTools` when the call
   * names them (D48); none when the model cannot call tools (`caps.tools`). The gateway's built-in tools (D61) are always
   * in the set, in the order of the registry: no profile, permission or `activeTools` filters them, and the profile's
   * `approvals` do not apply to them; a built-in's own `policy` still pauses (`dyna_aigw_ask_user_question`, D62).
   *
   * `approvals`: the tools whose `policy` is `NEEDS_APPROVAL`, plus the tools the profile lists (D87).
   *
   * Throws a 400 when `activeTools` names a tool the profile or the permissions do not allow (error 5373897180054): a call
   * narrows the set, never widens it. An additional tool whose name is in `allTools`, or given twice, is a 400 (error
   * 5374506419213).
   *
   * # Who needs it
   *
   * `prepareCall`, once per `run()`; `AIGateway.resume`, with the paused run's tool names, so the resumed run offers what
   * the paused one did.
   *
   * # Pitfalls
   *
   * The checks run before `caps.tools` is read: a bad `activeTools` is a 400 even on a model without tools. `resolved.tools`
   * is the run's whole set; what the model sees in a step is `narrowForStep`'s cut.
   */
  public resolve(
    {
      allTools,
      additionalTools = [],
      profile,
      userContext,
      caps,
      activeTools,
      builtInTools = [],
    }: {
      allTools: IToolDef[];
      /** Tools added for this call, on top of the registry's (D66). */
      additionalTools?: IToolDef[];
      profile: IAIProfile;
      userContext: IUserContext;
      caps: IModelCaps;
      /** The call's own selection; omitted = every tool the profile and the permissions allow. */
      activeTools?: string[];
      /** Names of the gateway's own tools among `allTools`; offered whatever the profile and the call say (D61). */
      builtInTools?: string[];
    },
  ): IResolvedTools {
    assertAppToolNames({
      tools: additionalTools,
      source: "additionalTools",
    });
    this.assertAdditionalToolsUnique(additionalTools, allTools);
    const isBuiltIn = (tool: IToolDef): boolean => builtInTools.includes(tool.name);
    const allowed = [
      ...allTools
        .filter(tool => !isBuiltIn(tool))
        .filter(tool => profile.allowedTools.includes(tool.name)),
      ...additionalTools,
    ]
      .filter(tool => this.isPermitted(tool.name, userContext.permissions));
    if (activeTools) this.assertActiveToolsAllowed(activeTools, allowed, profile.id);

    if (!caps.tools) {
      return {
        tools: [],
        approvals: new Set(),
      };
    }

    const selected = new Set(
      (
        activeTools
          ? allowed.filter(tool => activeTools.includes(tool.name))
          : allowed
      )
        .map(tool => tool.name),
    );
    const tools = [...allTools, ...additionalTools].filter(tool => isBuiltIn(tool) || selected.has(tool.name));
    const approvals = tools
      .filter(tool => tool.policy === EToolCallVerdict.NEEDS_APPROVAL || (!isBuiltIn(tool) && profile.approvals.includes(tool.name)))
      .map(tool => tool.name);

    return {
      tools,
      approvals: new Set(approvals),
    };
  }

  /**
   * narrowForStep -- the tools of one step of a run
   *
   * # About
   *
   * > Not every tool of the run is on the table at every step.
   *
   * A tool listed in `requires` stays hidden until every tool it requires has been executed in this run (D15, D88); a tool
   * with `visibleWhen` is shown only when its predicate says so for this step (D89); a tool must pass both. The approvals
   * follow the visible tools. Returns the same object when nothing was hidden.
   *
   * # Who needs it
   *
   * `createRunHooks`, for the loop's `prepareStep` hook, before every model call of a run.
   *
   * # Pitfalls
   *
   * `executed` is the run's list: tools run in earlier runs of the thread do not count, and a rejected or failed call is
   * not an execution (D76).
   */
  public narrowForStep(
    {
      resolved,
      executed,
      stepIndex,
    }: {
      resolved: IResolvedTools;
      /** Tool names already executed in this run. */
      executed: string[];
      stepIndex: number;
    },
  ): IResolvedTools {
    const requires = this.config.requires ?? {};
    const tools = resolved.tools
      .filter(tool => (requires[tool.name] ?? []).every(required => executed.includes(required)))
      .filter(tool => tool.visibleWhen?.({
        stepIndex,
        executed,
      }) ?? true);
    if (tools.length === resolved.tools.length) return resolved;
    return {
      tools,
      approvals: new Set(tools.map(tool => tool.name).filter(name => resolved.approvals.has(name))),
    };
  }

  /**
   * assertOfferedInStep -- refuses a call to a tool hidden for this step, naming what must run first when `requires` hid it
   *
   * # About
   *
   * > "Not yet" with the reason, instead of a bare "not available".
   *
   * A tool of the run that is not among the step's tools was hidden by `requires` (D88) or by its `visibleWhen` (D89). The
   * 403 thrown here says it is not offered in this step and, when `requires` names tools, which ones the model must run first,
   * so the model can recover in the next step instead of guessing. A tool outside the run is left to `ToolRegistry.execute`,
   * which refuses it as before (D72). A tool of the step passes.
   *
   * # Who needs it
   *
   * `createRunHooks`, in the loop's `executeTool`, before the registry runs the call.
   */
  public assertOfferedInStep(
    {
      name,
      resolved,
      tools,
    }: {
      name: string;
      /** The run's tools. */
      resolved: IResolvedTools;
      /** The step's tools, as the model saw them. */
      tools: IToolDef[];
    },
  ): void {
    if (tools.some(tool => tool.name === name)) return;
    if (!resolved.tools.some(tool => tool.name === name)) return;
    const requires = this.config.requires?.[name] ?? [];
    const because = requires.length > 0 ? `: it requires these tools to have run first: ${requires.join(", ")}` : "";
    const advice = requires.length > 0 ? `Call ${requires.join(", ")} first, then call it again.` : "Use one of the tools offered in this step, or answer without it.";
    throw dynaError({
      code: 5376189327010,
      status: 403,
      message: `ToolPolicy: tool [${name}] is not available in this step of the run${because}`,
      userMessage: `Tool [${name}] is not available in this step of the run. ${advice}`,
      data: {
        name,
        requires,
        offered: tools.map(tool => tool.name),
      },
    });
  }

  /**
   * decide -- the verdict on one tool call before it runs
   *
   * # About
   *
   * > Allow it, deny it with a reason, or hand it to a human.
   *
   * Applies the tool's `policy` (D87) and the profile's `approvals` to one call: a static verdict as it is; a predicate on the
   * parsed input and the user context; then the static approvals of `resolve` (the profile's `approvals`, the tools with
   * `policy: NEEDS_APPROVAL`) as the floor, which turn an ALLOW into NEEDS_APPROVAL. DENY wins over the floor: a human is never
   * asked to approve a call that would be refused. The agent loop asks before every call of a step, through the `decideToolCall` hook.
   *
   * # Who needs it
   *
   * `createRunHooks`, for the loop's `decideToolCall`.
   *
   * # Pitfalls
   *
   * A tool outside `resolved.tools` is ALLOW here: `ToolRegistry.execute` refuses it (D72). An input the schema rejects is ALLOW
   * too: it never reaches the predicate, `ToolRegistry.execute` reports it to the model (D50).
   */
  public async decide(
    {
      name,
      input,
      userContext,
      resolved,
    }: {
      name: string;
      /** The model's input, as requested. */
      input: unknown;
      userContext: IUserContext;
      resolved: IResolvedTools;
    },
  ): Promise<TToolCallPolicyResult> {
    const tool = resolved.tools.find(candidate => candidate.name === name);
    const own = tool ? await this.decideByTool(tool, input, userContext) : {verdict: EToolCallVerdict.ALLOW} as const;
    if (own.verdict === EToolCallVerdict.ALLOW && resolved.approvals.has(name)) return {verdict: EToolCallVerdict.NEEDS_APPROVAL};
    return own;
  }

  /**
   * endsRun -- whether an executed tool call is the run's final answer
   *
   * # About
   *
   * > Some tools are the end of the conversation: a handover, an order placed.
   *
   * True when the tool's `endsRun` is `true`, or when its predicate says so on the parsed input and the output (D86). A
   * tool outside `resolved.tools` or an input the schema rejects never ends the run: neither can have executed.
   *
   * # Who needs it
   *
   * `createRunHooks`, for the loop's `endsRun` hook, after every successful execution.
   *
   * # Pitfalls
   *
   * Ask only after a successful execution: a failed, refused or rejected call must not reach here, the loop keeps that
   * rule.
   */
  public async endsRun(
    {
      name,
      input,
      output,
      userContext,
      resolved,
    }: {
      name: string;
      /** The model's input, as requested. */
      input: unknown;
      /** What the tool returned. */
      output: unknown;
      userContext: IUserContext;
      resolved: IResolvedTools;
    },
  ): Promise<boolean> {
    const tool = resolved.tools.find(candidate => candidate.name === name);
    if (!tool?.endsRun) return false;
    if (tool.endsRun === true) return true;
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) return false;
    return tool.endsRun({
      input: parsed.data,
      output,
      userContext,
    });
  }

  /** Every name of `activeTools` must be one of the allowed tools; else a 400 naming the others. */
  private assertActiveToolsAllowed(activeTools: string[], allowed: IToolDef[], profileId: string): void {
    const notAllowed = activeTools.filter(name => !allowed.some(tool => tool.name === name));
    if (notAllowed.length === 0) return;
    throw dynaError({
      code: 5373897180054,
      status: 400,
      message: `ToolPolicy: activeTools names tools that the profile [${profileId}] or the user's permissions do not allow: ${notAllowed.join(", ")}`,
      data: {
        profileId,
        notAllowedTools: notAllowed,
      },
    });
  }

  /** An additional tool may not repeat a registry name or another additional one; else a 400. */
  private assertAdditionalToolsUnique(additionalTools: IToolDef[], allTools: IToolDef[]): void {
    const seen = new Set(allTools.map(tool => tool.name));
    const duplicates = additionalTools
      .map(tool => tool.name)
      .filter(name => seen.has(name) || !seen.add(name));
    if (duplicates.length === 0) return;
    throw dynaError({
      code: 5374506419213,
      status: 400,
      message: `ToolPolicy: additionalTools repeat a name of the registry or of each other: ${[...new Set(duplicates)].join(", ")}`,
      data: {duplicateTools: [...new Set(duplicates)]},
    });
  }

  /** A tool no permission maps to is open to everyone; a mapped one needs one that unlocks it. */
  private isPermitted(toolName: string, permissions: string[]): boolean {
    const unlockingPermissions = Object.entries(this.config.permissionsToTools ?? {})
      .filter(([, toolNames]) => toolNames.includes(toolName))
      .map(([permission]) => permission);
    return unlockingPermissions.length === 0 || unlockingPermissions.some(permission => permissions.includes(permission));
  }

  /**
   * The tool's own `policy` on this call.
   * Omitted → ALLOW; a verdict → as is (a static DENY with a fixed reason).
   * A predicate → on the parsed input; ALLOW when the schema rejects it.
   */
  private async decideByTool(tool: IToolDef, input: unknown, userContext: IUserContext): Promise<TToolCallPolicyResult> {
    const {policy} = tool;
    if (policy === undefined || policy === EToolCallVerdict.ALLOW) return {verdict: EToolCallVerdict.ALLOW};
    if (policy === EToolCallVerdict.NEEDS_APPROVAL) return {verdict: EToolCallVerdict.NEEDS_APPROVAL};
    if (policy === EToolCallVerdict.DENY) {
      return {
        verdict: EToolCallVerdict.DENY,
        reason: `The tool [${tool.name}] is switched off.`,
      };
    }
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) return {verdict: EToolCallVerdict.ALLOW};
    return policy({
      input: parsed.data,
      userContext,
    });
  }
}
