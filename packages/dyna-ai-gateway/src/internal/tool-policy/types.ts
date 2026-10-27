import {
  IToolDef,
  IUserContext,
  TToolCallPolicyResult,
} from "../../contracts";

import {IModelCaps} from "../model-registry";
import {IAIProfile} from "../ai-profile-store";

/**
 * The rules that decide which tools a run offers the model, and when. Lands in `IAIGatewayConfig.toolPolicy`.
 *
 * `ToolPolicy` applies them to the registry's tools and to a call's `additionalTools` (D66) alike: a tool the app adds on a
 * call still needs the permission that unlocks it, still pauses when the profile's `approvals` name it, still waits for the
 * tools it requires.
 */
export interface IToolPolicyConfig {
  /**
   * Which permission a user needs for a tool.
   *
   * > Keeps a tool away from users who may not use it, whatever the profile allows.
   *
   * Key: a permission of `IUserContext.permissions`. Value: the tools it unlocks. A tool that no permission names is open to
   * everyone; a tool named by several is open to a user who has any of them. Decided once, at the start of the run.
   *
   * @example {"billing.refund": ["refund"]} - only users with the billing.refund permission ever see the refund tool
   *
   * @default {}
   */
  permissionsToTools?: Record<string, string[]>;
  /**
   * The order of tools in a run: which tools must have run before another one is offered (D15, guarded workflows).
   *
   * > Forces a look-up before an action, so the model cannot act on a guess.
   *
   * Key: the guarded tool. Value: the tools that must have run earlier in **this run**, each with a result that is neither
   * rejected by the human nor failed (D76). Checked before every model step: a guarded tool whose required tools have not
   * all run is left out of that step's tool list, so the model is not told about it; it appears in the step after they ran.
   * A call to it anyway, by name, is refused with an error result that names the tools it requires (D88), also when its
   * input would need an approval (D79).
   * Tools not listed are offered from the first step. Earlier runs on the same thread do not count.
   *
   * @example {refund: ["lookup_order"]} - the model must look the order up before it may refund it
   *
   * @default {}
   */
  requires?: Record<string, string[]>;
}

/**
 * Registry ∩ Profile ∩ permissions ∩ caps. Stateless.
 *
 * Implemented by `ToolPolicy`; the type of `IAIGatewayDeps.toolPolicy`, so a host may pass its own in `overrides`.
 */
export interface IToolPolicy {
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
  resolve(args: {
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
  }): IResolvedTools;

  /**
   * Narrows the set for the next step of a run (guarded workflows): a tool listed in `requires` stays hidden
   * until every tool it requires has been executed in this run, and a tool with `visibleWhen` only when its predicate says so
   * for this step (D89). The approvals follow the visible tools.
   */
  narrowForStep(args: {
    resolved: IResolvedTools;
    /** Tool names already executed in this run. */
    executed: string[];
    stepIndex: number;
  }): IResolvedTools;

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
  assertOfferedInStep(args: {
    name: string;
    /** The run's tools. */
    resolved: IResolvedTools;
    /** The step's tools, as the model saw them. */
    tools: IToolDef[];
  }): void;

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
  decide(args: {
    name: string;
    /** The model's input, as requested. */
    input: unknown;
    userContext: IUserContext;
    resolved: IResolvedTools;
  }): Promise<TToolCallPolicyResult>;

  /**
   * True when this executed tool call ends the run (D86): the tool's `endsRun` is `true`, or its predicate says so on the parsed
   * input and the output. A tool outside `resolved.tools` or an input the schema rejects never ends the run: neither can have
   * executed. The caller asks only after a successful execution; a failed, refused or rejected call must not reach here.
   */
  endsRun(args: {
    name: string;
    /** The model's input, as requested. */
    input: unknown;
    /** What the tool returned. */
    output: unknown;
    userContext: IUserContext;
    resolved: IResolvedTools;
  }): Promise<boolean>;
}

/** The tools for one run and which of them pause. */
export interface IResolvedTools {
  tools: IToolDef[];
  /** Names that need a human before every execution: the profile's `approvals` and the tools with `policy: NEEDS_APPROVAL` (D87). */
  approvals: Set<string>;
}
