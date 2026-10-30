import {ISkill} from "../../contracts";

import {IModelRegistry} from "../model-registry";
import {IRunStore} from "../run-store";
import {IToolRegistry} from "../tool-registry";
import {ISkillRegistry} from "../skill-registry";
import {TWorkingMemoryStrategy} from "../working-memory";

/** Configuration of the AIProfileStore. Lands in IAIGatewayConfig.aiProfileStore. */
export interface IAIProfileStoreConfig {
  /** Persistence; Mongo in v1. */
  repository: IAIProfileRepository;
  /** Cache per tenant. Default 30_000. */
  cacheTtlMs?: number;
}

/** Shared instances AIProfileStore needs; created once by AIGateway and passed as the second constructor argument. */
export interface IAIProfileStoreDeps {
  modelRegistry: IModelRegistry;
  toolRegistry: IToolRegistry;
  runStore: IRunStore;
  /** Validates `IAIProfile.skills` at `upsertProfile` (D124). */
  skillRegistry: ISkillRegistry;
}

/**
 * Tenant-scoped store of AI Profiles.
 *
 * Implemented by `AIProfileStore`; the type of `IAIGatewayDeps.aiProfileStore`, so a host may pass its own in `overrides`.
 */
export interface IAIProfileStore {
  /** Loads one profile; throws if missing. */
  getProfile(args: {
    tenantId: string;
    profileId: string;
  }): Promise<IAIProfile>;

  /**
   * listProfiles -- the profiles of a tenant, for its administration screen and its model menu
   *
   * # About
   *
   * > Every profile of the tenant, as stored; empty for a tenant without one.
   *
   * Read through the tenant's cache like `getProfile`; the order is the repository's.
   */
  listProfiles(args: {tenantId: string}): Promise<IAIProfile[]>;

  /**
   * Admin: creates or replaces; validates modelId (and cheapModelId, when set) against ModelRegistry,
   * allowedTools / approvals against ToolRegistry, and the names of `skills` with the SkillRegistry (unique, non-empty).
   * The registry's own error surfaces for an unknown or disabled model.
   */
  upsertProfile(args: {
    tenantId: string;
    profile: IAIProfile;
  }): Promise<void>;

  /**
   * removeProfile -- deletes a profile of a tenant
   *
   * # About
   *
   * > A profile a paused run waits on stays: the run resumes on it (D46).
   *
   * An unknown profile is the 404 of `getProfile`. A profile named by a PAUSED run of the tenant is refused with a 409
   * (`data.runIds`): resume or cancel those runs first. There is no default profile to protect (D103). A thread is not
   * bound to a profile (D46), so nothing else holds one.
   */
  removeProfile(args: {
    tenantId: string;
    profileId: string;
  }): Promise<void>;
}

/** Persistence seam. Only the store calls it. */
export interface IAIProfileRepository {
  loadByTenant(args: {tenantId: string}): Promise<IAIProfile[]>;
  save(args: {
    tenantId: string;
    profile: IAIProfile;
  }): Promise<void>;
  remove(args: {
    tenantId: string;
    profileId: string;
  }): Promise<void>;
}

/** Tenant choices for one way of using AI. Passed as data to Assembler, ToolPolicy, LLMClient. */
export interface IAIProfile {
  id: string;
  tenantId: string;
  /** Human label, e.g. "Careful refunds". */
  name: string;
  /** Main model; must exist and be enabled in ModelRegistry. */
  modelId: string;
  /** Model for helper calls (memory, rewrite). Empty = platform default. */
  cheapModelId?: string;
  /** Tool names the LLM may see. Subset of ToolRegistry. */
  allowedTools: string[];
  /** Tool names that pause for a human before execution. */
  approvals: string[];
  /**
   * Every answer of a `run()` on this profile waits for a human before the end user sees it (D99).
   *
   * > Gates the words, as `approvals` gates the actions: a moderator reads the reply, a clerk checks the drafted letter.
   *
   * The run pauses with a RESULT_REVIEW envelope after the answer passed the output checks; the reviewer approves, edits or
   * rejects it through `resume()`. `ask()` on such a profile is refused: it has no run to pause. Leave it off for a chat whose
   * answers the user reads directly.
   *
   * @example true - a support bot whose replies an agent checks before the customer sees them
   *
   * @default false
   */
  reviewAnswers?: boolean;
  /**
   * The tool calls of one model step run at the same time (D101).
   *
   * > An agent step that looks up three things waits for the slowest, not for the sum.
   *
   * A model that asks for several tools in one step gets no result before the step is out, so the calls are independent by
   * construction: the gateway decides every call first, runs every allowed one concurrently, stores the results in the
   * order of the request and pauses once with every call that needs a human. The calls of a tool whose `policy` is a
   * predicate are decided and run one by one after the others (D112): such a policy may read state the step changes, like
   * "already refunded", and must see the earlier calls. Switch it off for a profile whose tools
   * must not overlap (two writes to the same record, a rate-limited API): the calls then run one after the other, and a
   * call that needs a human pauses the run before the calls after it are decided.
   *
   * @example false - a chat profile whose tools write to one ledger and must not overlap
   *
   * @default true
   */
  parallelToolCalls?: boolean;
  /**
   * How this profile's threads reach the model: raw sliding window or summary buffer.
   *
   * > One tenant, two bots: precise chat on one, cheap long threads on the other.
   *
   * Overrides `IWorkingMemoryConfig.strategy`; `IWorkingMemoryConfig.enabled` stays gateway-wide. A thread keeps its
   * stored summary when the strategy switches: `SLIDING_WINDOW` ignores it, a switch back resumes from it.
   * Read by the built-in `WorkingMemory`; a host memory may read it or ignore it.
   *
   * @example {type: EWorkingMemoryStrategy.SLIDING_WINDOW} - a support chat whose answers must quote the user's own words
   *
   * @default undefined - the gateway's default strategy
   */
  workingMemory?: TWorkingMemoryStrategy;
  /** Tenant text appended to the CHAT_MAIN system prompt. */
  promptAddendum: string;
  /**
   * Instructions the model loads on demand on every call of this profile (D124).
   *
   * > A profile's long rules without paying for them on every call.
   *
   * Listed by name and description in the system prompt of a `run()`, loaded with `load_skill` when a task needs one;
   * inlined whole in an `ask()`. Merged with the call's `skills`; a name present in both is a 400. Names must be unique
   * here too: `upsertProfile` refuses a duplicate.
   *
   * @example [{name: "refund_policy", description: "…", body: "…"}] - the shop's refund rules, read only when a refund comes up
   *
   * @default undefined - no skills
   */
  skills?: ISkill[];
  /** The loop and output caps of the profile. */
  limits: IAIProfileLimits;
  /** Reserved v2 seam: per-key template body overrides. */
  templateOverrides?: Record<string, string>;
}

/** Loop and output limits of a profile; what may be spent is the app's decision (`IAIGatewayConfig.usageGuard`). */
export interface IAIProfileLimits {
  /** Model calls per run (agent loop cap). */
  maxStepsPerRun: number;
  /** Cap for one answer. */
  maxOutputTokens: number;
}
