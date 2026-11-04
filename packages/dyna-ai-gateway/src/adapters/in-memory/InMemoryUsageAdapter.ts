import {
  IUsageAddArgs,
  IUsageAdapter,
  IUsageCheckArgs,
  IUsageCheckResult,
} from "../../internal/usage-guard";

/**
 * Configuration of the `InMemoryUsageAdapter`.
 *
 * Only tests and the sandbox construct it; the one option scripts the denials.
 */
export interface IInMemoryUsageAdapterConfig {
  /**
   * Decides a `check`: `true` or a result with `approved: false` denies, anything else approves.
   *
   * > Scripts the app's "no" in a test: deny a user, a kind, a model, the second call.
   *
   * @example ({userId}) => userId === "user-b" - user B is out, everyone else is in
   *
   * @default every check is approved
   */
  deny?: (call: IUsageCheckArgs) => boolean | IUsageCheckResult;
}

/** The `denyCode` of a check denied by `IInMemoryUsageAdapterConfig.deny` returning `true`. */
export const IN_MEMORY_USAGE_DENY_CODE = "denied_by_test";

/**
 * InMemoryUsageAdapter -- the usage adapter of the tests and the sandbox
 *
 * # About
 *
 * > A test double, not a limit.
 *
 * Records every `check` and every `addUsage` it receives, so a test can read what the gateway asked and reported, and denies
 * when its `deny` option says so. It keeps no totals and enforces nothing: a daily limit shipped by the gateway would be token
 * logic in the gateway, which is exactly what the app owns.
 *
 * # Who needs it
 *
 * The test configs (`gatewayConfigBase`) and `src/dev-sandbox/sandbox.config.ts`. An application writes its own adapter.
 *
 * # Usage
 *
 * ## When shouldn't use it
 *
 * In an application: it approves everything and forgets everything at restart.
 */
export class InMemoryUsageAdapter implements IUsageAdapter {
  /** Every `check` received, in order. */
  public readonly checkCalls: IUsageCheckArgs[] = [];

  /** Every `addUsage` received, in order. */
  public readonly addUsageCalls: IUsageAddArgs[] = [];

  constructor(private readonly config: IInMemoryUsageAdapterConfig = {}) {}

  /**
   * check -- may this model call run?
   *
   * # About
   *
   * > The app's answer, before every model call the gateway makes.
   *
   * Asked for the answer, every run step, every guardrail judge, query rewrite, memory update and embedding, with the call's
   * factors and its rough size. A throw is treated as a denial (fail closed) and logged.
   *
   * # Who needs it
   *
   * `UsageGuard.check`, right before the provider is called.
   */
  public async check(args: IUsageCheckArgs): Promise<IUsageCheckResult> {
    this.checkCalls.push(args);
    const verdict = this.config.deny?.(args);
    if (verdict === true) {
      return {
        approved: false,
        denyCode: IN_MEMORY_USAGE_DENY_CODE,
      };
    }
    if (verdict && !verdict.approved) return verdict;
    return {approved: true};
  }

  /**
   * addUsage -- what the call used
   *
   * # About
   *
   * > Told once after every approved `check`, also for a failed or aborted call.
   *
   * Then with zero usage, so an adapter that reserves in `check` can always settle by `traceId`. A throw is logged; the call's
   * answer is still returned.
   *
   * # Who needs it
   *
   * `UsageGuard.addUsage`, after every provider call.
   */
  public async addUsage(args: IUsageAddArgs): Promise<void> {
    this.addUsageCalls.push(args);
  }
}
