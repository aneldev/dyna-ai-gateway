import {TThreadIds} from "../../contracts";
import {
  IRun,
  IRunRepository,
  ERunStatus,
} from "../../internal/run-store";

import {makeTenantKey} from "./utils/makeTenantKey";

/**
 * InMemoryRunRepository -- the run repository in a Map, for tests and the sandbox
 *
 * # About
 *
 * > Behaves like a database without one: copies in and out, lists in insertion order.
 *
 * Implements `IRunRepository` so the `RunStore` runs with no infrastructure. `transition` is atomic by construction: one
 * synchronous read and write with no await between them, which is what a real adapter gets from a conditional update.
 *
 * # Who needs it
 *
 * The gateway tests (`gatewayConfigBase`), the dev sandbox and the cookbook's first run; a host app uses its own adapter.
 *
 * # Pitfalls
 *
 * Production: nothing survives the process, nothing is shared between processes.
 */
export class InMemoryRunRepository implements IRunRepository {
  private readonly runs = new Map<string, IRun>();

  /**
   * save -- creates or replaces the run
   *
   * # About
   *
   * > Whole, by `id` within the tenant.
   *
   * The run as the gateway holds it: request, messages, status, pending calls, answer.
   *
   * # Who needs it
   *
   * `RunStore.save` and `setStatus`.
   */
  public async save(
    {run}: {run: IRun},
  ): Promise<void> {
    this.runs.set(makeTenantKey(run.tenantId, run.id), structuredClone(run));
  }

  /**
   * load -- the run of a tenant by id
   *
   * # About
   *
   * > Null when missing or of another tenant.
   *
   * The run as stored, whole.
   *
   * # Who needs it
   *
   * `RunStore.load`.
   */
  public async load(
    {
      tenantId,
      runId,
    }: {
      tenantId: string;
      runId: string;
    },
  ): Promise<IRun | null> {
    const run = this.runs.get(makeTenantKey(tenantId, runId));
    return run ? structuredClone(run) : null;
  }

  /**
   * listByStatus -- the tenant's runs in one status
   *
   * # About
   *
   * > Narrowed to one user when `userId` is given; any order.
   *
   * Every run of the tenant whose `status` matches.
   *
   * # Who needs it
   *
   * `RunStore.listPaused` and `listRunning`.
   */
  public async listByStatus(
    {
      tenantId,
      status,
      userId,
    }: {
      tenantId: string;
      status: ERunStatus;
      userId?: string;
    },
  ): Promise<IRun[]> {
    return [...this.runs.values()]
      .filter(run => run.tenantId === tenantId)
      .filter(run => run.status === status)
      .filter(run => userId === undefined || run.userId === userId)
      .map(run => structuredClone(run));
  }

  /**
   * transition -- moves a run from one status to another atomically
   *
   * # About
   *
   * > Compare-and-set (D69): two callers racing for the same run, exactly one gets it.
   *
   * Returns the updated run, or null when the run is missing or not in `from`; `pending` is cleared when `to` is not PAUSED.
   * One database operation with the condition in the filter, never a load followed by a save.
   *
   * # Who needs it
   *
   * `RunStore.transition`, for every status change that must be taken once: a resume, a cancel, an expiry.
   */
  public async transition(
    {
      tenantId,
      runId,
      from,
      to,
    }: {
      tenantId: string;
      runId: string;
      from: ERunStatus;
      to: ERunStatus;
    },
  ): Promise<IRun | null> {
    const key = makeTenantKey(tenantId, runId);
    const run = this.runs.get(key);
    if (!run || run.status !== from) return null;
    const moved: IRun = {
      ...run,
      status: to,
      pending: to === ERunStatus.PAUSED ? run.pending : undefined,
      updatedAt: new Date(),
    };
    this.runs.set(key, structuredClone(moved));
    return structuredClone(moved);
  }

  /**
   * delete -- hard-deletes the runs of threads
   *
   * # About
   *
   * > The listed ids, or every run of the tenant for `"all"`.
   *
   * Narrowed to one user when `userId` is given. Returns how many went.
   *
   * # Who needs it
   *
   * `RunStore.delete`, for the gateway's `delete` and `deleteUserData`.
   */
  public async delete(
    {
      tenantId,
      threadIds,
      userId,
    }: {
      tenantId: string;
      threadIds: TThreadIds;
      userId?: string;
    },
  ): Promise<number> {
    const keys = [...this.runs.entries()]
      .filter(([, run]) =>
        run.tenantId === tenantId
        && (userId === undefined || run.userId === userId)
        && (threadIds === "all" || threadIds.includes(run.threadId)))
      .map(([key]) => key);
    for (const key of keys) this.runs.delete(key);
    return keys.length;
  }

  /**
   * anonymizeByUser -- keeps a user's runs as skeletons
   *
   * # About
   *
   * > GDPR pseudonymisation: the words go, the record stays.
   *
   * `userId` becomes the pseudonym; `messages`, `request.system`, `request.outputSchema`, `skills`, `pending` and `answer` are
   * emptied; a RUNNING or PAUSED run becomes CANCELLED; id, status, steps and dates stay. Returns how many.
   *
   * # Who needs it
   *
   * `RunStore.anonymizeByUser`, for the gateway's `anonymizeUserData`.
   */
  public async anonymizeByUser(
    {
      tenantId,
      userId,
      pseudonym,
    }: {
      tenantId: string;
      userId: string;
      pseudonym: string;
    },
  ): Promise<number> {
    const keys = this.getKeysOfUser(tenantId, userId);
    for (const key of keys) {
      const run = this.runs.get(key);
      if (!run) continue;
      const isOpen = run.status === ERunStatus.RUNNING || run.status === ERunStatus.PAUSED;
      this.runs.set(key, {
        ...run,
        userId: pseudonym,
        status: isOpen ? ERunStatus.CANCELLED : run.status,
        request: {
          ...run.request,
          system: [],
        },
        messages: [],
        skills: undefined,
        pending: undefined,
        answer: undefined,
        updatedAt: isOpen ? new Date() : run.updatedAt,
      });
    }
    return keys.length;
  }

  /** The Map keys of the user's runs. */
  private getKeysOfUser(tenantId: string, userId: string): string[] {
    return [...this.runs.entries()]
      .filter(([, run]) => run.tenantId === tenantId && run.userId === userId)
      .map(([key]) => key);
  }
}
