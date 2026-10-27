import {
  IUsageAddArgs,
  IUsageCheckArgs,
  IUsageCheckResult,
  IUsageGuard,
  IUsageGuardConfig,
  USAGE_CHECK_FAILED_DENY_CODE,
} from "./types";

/**
 * UsageGuard -- asks the app before every model call and tells it what the call used
 *
 * # About
 *
 * > The gateway holds no token logic; it asks, it reports.
 *
 * Wraps the app's `IUsageAdapter` so that no model call can skip it and no adapter failure can break a call the wrong way:
 *
 * - `check` before every provider call: a throw of the adapter becomes a denial (fail closed) and is logged.
 * - `addUsage` after every approved check, also for a failed or aborted call: a throw of the adapter is logged, the answer
 *   is still returned.
 *
 * Who may spend what, how much is left, per day, per user, per model, with credits or in dollars — all of that is the app's,
 * inside its adapter. The guard holds no state, no numbers and no ledger.
 *
 * # Who needs it
 *
 * The `LLMClient`, around every `complete`, `run` step and `embed`. Constructed once by `AIGateway` from
 * `IAIGatewayConfig.usageGuard` and reachable as `gateway.usageGuard`.
 *
 * # What needs
 *
 * `IUsageGuardConfig.adapter`: the app's adapter, or `InMemoryUsageAdapter` in tests and the sandbox.
 *
 * # Pitfalls
 *
 * One adapter call before and one after every model call — about five to eight per `ask` with guardrails, knowledge base
 * and memory. An adapter that reads a database should keep that read fast or cache.
 */
export class UsageGuard implements IUsageGuard {
  constructor(private readonly config: IUsageGuardConfig) {}

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
  public async check(args: IUsageCheckArgs): Promise<IUsageCheckResult> {
    try {
      return await this.config.adapter.check(args);
    }
    catch (error) {
      console.error(`Internal error 5378215504011: UsageGuard: the usage adapter's check threw for call [${args.traceId}] of tenant [${args.tenantId}]; the call is refused`, error);
      return {
        approved: false,
        denyCode: USAGE_CHECK_FAILED_DENY_CODE,
      };
    }
  }

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
  public async addUsage(args: IUsageAddArgs): Promise<void> {
    try {
      await this.config.adapter.addUsage(args);
    }
    catch (error) {
      console.error(`Internal error 5378215504012: UsageGuard: the usage adapter's addUsage threw for call [${args.traceId}] of tenant [${args.tenantId}]; the usage is not recorded by the app`, error);
    }
  }
}
