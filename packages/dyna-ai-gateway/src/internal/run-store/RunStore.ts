import {dynaError} from "dyna-error";

import {TThreadIds} from "../../contracts";

import {
  IRun,
  IRunStore,
  IRunStoreConfig,
  ERunStatus,
} from "./types";

/**
 * RunStore -- the persisted state of the agent runs
 *
 * # About
 *
 * > A run outlives the request that started it: it pauses for a human, resumes in another process, survives a crash.
 *
 * Implements `IRunStore` over the host's `IRunRepository`: the run's request as built for step 1, its messages so far in
 * `LLMClient` shape, the envelopes of its pause and its status (`ERunStatus`), scoped by tenant. One thread has at most
 * one open run. The store adds to the repository what every caller needs the same way: the 404 of `load`, the status
 * lists, `setStatus`, and `transition`, the compare-and-set that lets exactly one of several racing callers move a run
 * (D69).
 *
 * It sits under the `HumanGate` (pause, resume, cancel, expire) and the settlement of the call path (`settleRun`,
 * `closeRun`).
 *
 * # Who needs it
 *
 * `HumanGate` for every pause and decision; `settleRun`, `settleReview`, `closeRun` for the status of a finished run;
 * `AIGateway.getPausedRun`, `recoverStuckRuns` and the resume path; `AIProfileStore` to refuse deleting a profile with
 * paused runs; `forgetUser` and `deleteThreads` for the GDPR paths. A host replaces it with its own `IRunStore` in
 * `overrides.runStore`.
 *
 * # What needs
 *
 * Nothing shared: `config.repository` is the storage.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, through the gateway: `createGatewayDeps` creates it from `IAIGatewayConfig.runStore`.
 *
 * ## When shouldn't use it
 *
 * A host that needs another storage writes an `IRunRepository`, not an `IRunStore`: the atomic `transition` is the
 * repository's duty, and the store's logic is the same for every database.
 *
 * # Pitfalls
 *
 * `setStatus` is read-then-save, not atomic: it is for status changes nobody races for. A status two callers can race
 * for (a resume against a cancel) goes through `transition`.
 */
export class RunStore implements IRunStore {
  constructor(private readonly config: IRunStoreConfig) {}

  /**
   * save -- creates or replaces a run
   *
   * # About
   *
   * > The whole run, as it is now.
   *
   * Passes the run to the repository, which replaces it by `id`.
   *
   * # Who needs it
   *
   * `HumanGate.pause` (the first write of a run that pauses), the settlement of a review (`settleReview`), and the resume
   * path when the run switches profile (D65).
   */
  public async save(
    {run}: {run: IRun},
  ): Promise<void> {
    await this.config.repository.save({run});
  }

  /**
   * load -- one run of the tenant
   *
   * # About
   *
   * > The run, or a 404.
   *
   * Throws a 404 (error 5372577355245) when the run is missing or belongs to another tenant; the repository's null never
   * reaches a caller.
   *
   * # Who needs it
   *
   * `HumanGate.resume`, `getPending` and `cancel`; `AIGateway.getPausedRun`, `cancelRun` and the resume path; `closeRun`.
   */
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

  /**
   * listPaused -- the runs waiting for a human
   *
   * # About
   *
   * > The inbox.
   *
   * The tenant's PAUSED runs, narrowed to one user when `userId` is given.
   *
   * # Who needs it
   *
   * `HumanGate.listPaused` and `expirePaused`; `AIProfileStore.removeProfile`, which refuses while a paused run uses the
   * profile.
   */
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

  /**
   * listRunning -- the runs marked RUNNING
   *
   * # About
   *
   * > A live call's run, or one an instance that died left behind.
   *
   * The tenant's RUNNING runs. A RUNNING run whose thread has no live lease is stuck (D97).
   *
   * # Who needs it
   *
   * `AIGateway.recoverStuckRuns`, from a scheduled job of the application.
   */
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

  /**
   * setStatus -- changes the status of a run
   *
   * # About
   *
   * > For the status changes nobody races for.
   *
   * Loads the run (a 404 when missing) and saves it with the new status and `updatedAt` now; nothing else changes.
   *
   * # Who needs it
   *
   * `settleRun` (DONE, FAILED after a resumed run finished), `closeRun`, `AIGateway.closeFailedRun`.
   *
   * # Pitfalls
   *
   * Read-then-save: a concurrent writer can be overwritten. PAUSED to anything is `transition`'s job.
   */
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

  /**
   * delete -- hard-deletes the runs of threads
   *
   * # About
   *
   * > The threads go, their runs go with them (D119).
   *
   * Removes the runs of the listed thread ids, or of every thread of the tenant with `"all"`, narrowed to one user when
   * `userId` is given. Returns how many.
   *
   * # Who needs it
   *
   * `deleteThreads` (behind `AIGateway.deleteThreads`) and `forgetUser` (behind `AIGateway.deleteUserData`, D54).
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
    return this.config.repository.delete({
      tenantId,
      threadIds,
      userId,
    });
  }

  /**
   * anonymizeByUser -- keeps a user's runs as skeletons under a pseudonym
   *
   * # About
   *
   * > The record that a run happened stays; what the user said in it goes.
   *
   * The repository replaces `userId` with the pseudonym and empties `messages`, `request.system`, `skills`, `pending` and
   * `answer`; id, status, steps and dates stay. An open run (RUNNING or PAUSED) becomes CANCELLED, since nobody can resume
   * it. Returns how many.
   *
   * # Who needs it
   *
   * `forgetUser`, behind `AIGateway.anonymizeUserData` (D54).
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
