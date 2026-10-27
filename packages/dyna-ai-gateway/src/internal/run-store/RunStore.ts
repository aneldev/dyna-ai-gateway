import {dynaError} from "dyna-error";

import {TThreadIds} from "../../contracts";

import {
  IRun,
  IRunStore,
  IRunStoreConfig,
  ERunStatus,
} from "./types";

/** Tenant-scoped persistence of runs. */
export class RunStore implements IRunStore {
  constructor(private readonly config: IRunStoreConfig) {}

  /** Creates or replaces a run. */
  public async save(
    {run}: {run: IRun},
  ): Promise<void> {
    await this.config.repository.save({run});
  }

  /** Loads a run; throws if missing or not owned by the tenant. */
  public async load(
    {
      tenantId,
      runId,
    }: {
      tenantId: string;
      runId: string;
    },
  ): Promise<IRun> {
    const run = await this.config.repository.load({
      tenantId,
      runId,
    });
    if (!run) {
      throw dynaError({
        code: 5372577355245,
        status: 404,
        message: `RunStore: unknown run [${runId}] for tenant [${tenantId}]`,
        data: {
          tenantId,
          runId,
        },
      });
    }
    return run;
  }

  /** Runs waiting for a human, for the UI inbox. */
  public async listPaused(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId?: string;
    },
  ): Promise<IRun[]> {
    return this.config.repository.listByStatus({
      tenantId,
      status: ERunStatus.PAUSED,
      userId,
    });
  }

  /** Runs marked RUNNING: a live call's, or one an instance that died left behind (`recoverStuckRuns`, D97). */
  public async listRunning({tenantId}: {tenantId: string}): Promise<IRun[]> {
    return this.config.repository.listByStatus({
      tenantId,
      status: ERunStatus.RUNNING,
    });
  }

  /**
   * transition -- moves a run from one status to another, atomically
   *
   * # About
   *
   * > Compare-and-set on the status: the run moves only if it is still in `from`.
   *
   * Returns the moved run, or null when the run is missing or already left `from`. Of several callers racing for the
   * same run, exactly one gets it (D69); the others read null and must refuse.
   *
   * # Who needs it
   *
   * `HumanGate.resume` (PAUSED to RUNNING) and `HumanGate.cancel` (PAUSED to CANCELLED).
   *
   * # Usage
   *
   * ## When shouldn't use it
   *
   * A status change that nobody can race for: `setStatus`.
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
    return this.config.repository.transition({
      tenantId,
      runId,
      from,
      to,
    });
  }

  /** Changes status only (and updatedAt). */
  public async setStatus(
    {
      tenantId,
      runId,
      status,
    }: {
      tenantId: string;
      runId: string;
      status: ERunStatus;
    },
  ): Promise<void> {
    const run = await this.load({
      tenantId,
      runId,
    });
    await this.config.repository.save({
      run: {
        ...run,
        status,
        updatedAt: new Date(),
      },
    });
  }

  /** Hard-deletes the runs of threads: the listed ids or `"all"`, of one user when `userId` is given. Returns how many. */
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
    return this.config.repository.delete({
      tenantId,
      threadIds,
      userId,
    });
  }

  /**
   * Keeps every run of a user as a skeleton under the pseudonym (GDPR pseudonymisation): no messages, no system prompt, no pending
   * pause; an open run is CANCELLED, since nobody can resume it. Returns how many.
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
    return this.config.repository.anonymizeByUser({
      tenantId,
      userId,
      pseudonym,
    });
  }
}
