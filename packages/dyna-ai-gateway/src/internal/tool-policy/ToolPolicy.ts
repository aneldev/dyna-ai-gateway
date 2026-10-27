import {dynaError} from "dyna-error";

import {
  EToolCallVerdict,
  IToolDef,
  IUserContext,
  TToolCallPolicyResult,
} from "../../contracts";

import {IModelCaps} from "../model-registry";
import {IAIProfile} from "../ai-profile-store";

import {
  IResolvedTools,
  IToolPolicy,
  IToolPolicyConfig,
} from "./types";

/** Registry ∩ Profile ∩ permissions ∩ caps. Stateless. */
export class ToolPolicy implements IToolPolicy {
  constructor(private readonly config: IToolPolicyConfig) {
  }

  /**
   * Computes the tool set for a run: the tools the profile allows and the user's permissions unlock, narrowed to `activeTools` when the call
   * names them (D48); none when the model cannot call tools.
   * The gateway's built-in tools (D61) are always in the set, in the order of the registry: no profile, permission or activeTools
   * filters them, and the profile's `approvals` do not apply to them; a built-in's own `policy` still pauses (`ask_user_question`, D62).
   * Approvals: the tools whose `policy` is `NEEDS_APPROVAL`, plus the tools the profile lists (D87).
   * Throws a 400 when `activeTools` names a tool the profile or the user's permissions do not allow: a call can narrow the set, never widen it.
   * The tools added for the call (`additionalTools`, D66) are allowed because the app passed them; the permissions still apply.
   * An additional tool whose name is in `allTools`, or given twice, is a 400.
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
   * Narrows the set for the next step of a run (guarded workflows): a tool listed in `requires` stays hidden
   * until every tool it requires has been executed in this run, and a tool with `visibleWhen` only when its predicate says so
   * for this step (D89). The approvals follow the visible tools.
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
   * True when this executed tool call ends the run (D86): the tool's `endsRun` is `true`, or its predicate says so on the parsed
   * input and the output. A tool outside `resolved.tools` or an input the schema rejects never ends the run: neither can have
   * executed. The caller asks only after a successful execution; a failed, refused or rejected call must not reach here.
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

  /** An additional tool may not repeat a name of the registry or of another additional tool; else a 400 naming them. */
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

  /** A tool no permission maps to is open to everyone; a mapped tool needs one of the permissions that unlock it. */
  private isPermitted(toolName: string, permissions: string[]): boolean {
    const unlockingPermissions = Object.entries(this.config.permissionsToTools ?? {})
      .filter(([, toolNames]) => toolNames.includes(toolName))
      .map(([permission]) => permission);
    return unlockingPermissions.length === 0 || unlockingPermissions.some(permission => permissions.includes(permission));
  }

  /** The tool's own `policy` on this call: omitted → ALLOW; a verdict → as is (a static DENY with a fixed reason); a predicate → on the parsed input, ALLOW when the schema rejects it. */
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
