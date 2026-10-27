import {IUsage} from "../../contracts";

import {ETraceKind} from "../trace";

/** The `denyCode` of a call refused because the adapter's `check` threw: the app gave no answer, so the gateway gives its own. */
export const USAGE_CHECK_FAILED_DENY_CODE = "usage_check_failed";

/** The `code` of the `dynaError` a model call is refused with when the app said no (status 429). */
export const USAGE_DENIED_ERROR_CODE = 5378215504021;

/**
 * The `data` of the error a refused model call throws.
 *
 * Read by the orchestration to build the issue `usage_denied`; the app's code and message travel through unchanged.
 */
export interface IUsageDeniedErrorData {
  /** The trace id the refused call would have had; the adapter saw it in `check`. */
  traceId: string;
  denyCode?: string;
  denyUserMessage?: string;
}

/**
 * Configuration of the UsageGuard. Lands in `IAIGatewayConfig.usageGuard`.
 *
 * The app passes the one adapter that answers for its usage rules; the gateway constructs the guard around it.
 */
export interface IUsageGuardConfig {
  /** The app's answer to "may this model call run?" and the receiver of what every call used. */
  adapter: IUsageAdapter;
}

/**
 * The gateway holds no token logic; it asks, it reports.
 *
 * Implemented by `UsageGuard`; the type of `IAIGatewayDeps.usageGuard`, so a host may pass its own in `overrides`.
 */
export interface IUsageGuard {
  /**
   * check -- may this model call run?
   *
   * # About
   *
   * > One question to the app, fail closed.
   *
   * Passes the call's factors and its rough size to the adapter and returns its answer. When the adapter throws, the call is
   * refused with `USAGE_CHECK_FAILED_DENY_CODE` and the error is logged: an app that cannot answer has not said yes.
   *
   * # Who needs it
   *
   * The `LLMClient`, right before a provider call.
   */
  check(args: IUsageCheckArgs): Promise<IUsageCheckResult>;

  /**
   * addUsage -- tells the app what the call used
   *
   * # About
   *
   * > One report to the app, never fatal.
   *
   * Passes the report to the adapter. When the adapter throws, the error is logged and nothing else happens: the call already
   * ran and its answer belongs to the user.
   *
   * # Who needs it
   *
   * The `LLMClient`, after every approved check — also when the provider call failed or was aborted.
   */
  addUsage(args: IUsageAddArgs): Promise<void>;
}

/**
 * The seam between the gateway and the app's usage rules: asked before every model call, told after it.
 *
 * Implemented by the app (plans, limits, ledgers, per-model access, credits — whatever it wants) and by
 * `InMemoryUsageAdapter` for tests. The `UsageGuard` is its only caller; the `LLMClient` goes through the guard.
 */
export interface IUsageAdapter {
  /**
   * May this model call run?
   *
   * > Asked before every model call the gateway makes: the answer, every run step, every guardrail judge, query rewrite,
   * > memory update and embedding.
   *
   * A throw is treated as a denial (fail closed) and logged.
   */
  check(args: IUsageCheckArgs): Promise<IUsageCheckResult>;
  /**
   * What the call used.
   *
   * > Told once after every approved `check`, also when the provider call failed or was aborted (then with zero usage),
   * > so an adapter that reserves in `check` can always settle.
   *
   * A throw is logged; the call's answer is still returned.
   */
  addUsage(args: IUsageAddArgs): Promise<void>;
}

/**
 * The factors of one model call, the same on `check` and `addUsage`.
 *
 * Everything the gateway knows about who calls which model for what; the adapter decides with it.
 */
export interface IUsageCall {
  /** The id of the call's trace entry: links a report to the trace and pairs a `check` with its `addUsage`. */
  traceId: string;
  tenantId: string;
  /** Absent for system jobs (e.g. KB ingestion). */
  userId?: string;
  /** The profile the call runs on. Absent for system jobs (e.g. KB ingestion). */
  profileId?: string;
  modelId: string;
  /** What the call is for: the answer, a run step, a guardrail judge, a query rewrite, an embedding, a memory update. */
  kind: ETraceKind;
  threadId?: string;
  runId?: string;
}

/**
 * The question of a `check`: the call's factors and a rough size of the call.
 *
 * Built by the `LLMClient` from the request it is about to send.
 */
export interface IUsageCheckArgs extends IUsageCall {
  /**
   * A rough size of the call, for an adapter that wants to compare before it answers.
   *
   * > `input` is the estimate of the request (about one token per four characters); `output` is the call's `maxOutputTokens`, the worst case.
   */
  neededTokens: {
    input: number;
    output: number;
  };
}

/**
 * The adapter's answer to a `check`.
 *
 * Read by the `UsageGuard`; on a denial the gateway refuses the call with the issue `usage_denied` and passes the app's
 * code and message through unchanged.
 */
export interface IUsageCheckResult {
  approved: boolean;
  /**
   * The app's own code of the denial, for its UI to branch on.
   *
   * @example "daily_limit_reached" - the UI shows the plan upgrade
   */
  denyCode?: string;
  /** A message for the end user, already in the user's language; the gateway shows it as it is. */
  denyUserMessage?: string;
}

/**
 * The report of an `addUsage`: the call's factors and what it used.
 *
 * Built by the `LLMClient` after the provider answered, failed or was aborted.
 */
export interface IUsageAddArgs extends IUsageCall {
  /** When the call ended. */
  date: Date;
  /** What the provider reported; all zero when it reported nothing (a failed or aborted call). */
  usage: IUsage;
  /**
   * Informative: list prices of the model times the tokens, in USD. No exchange rates, no discounts, no reservations.
   *
   * > An app that bills in its own currency or credits computes from `usage`, not from this.
   */
  costUsd: number;
}
