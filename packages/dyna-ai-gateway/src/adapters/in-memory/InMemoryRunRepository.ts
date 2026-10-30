import {TThreadIds} from "../../contracts";
import {
  IRun,
  IRunRepository,
  ERunStatus,
} from "../../internal/run-store";

import {makeTenantKey} from "./utils/makeTenantKey";

/** Runs in a Map. Copies in and out, like a database; lists keep insertion order. */
export class InMemoryRunRepository implements IRunRepository {
  private readonly runs = new Map<string, IRun>();

  public async save(
    {run}: {run: IRun},
  ): Promise<void> {
    this.runs.set(makeTenantKey(run.tenantId, run.id), structuredClone(run));
  }

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

  /** Atomic by construction: one synchronous read and write, no await between them. */
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

  private getKeysOfUser(tenantId: string, userId: string): string[] {
    return [...this.runs.entries()]
      .filter(([, run]) => run.tenantId === tenantId && run.userId === userId)
      .map(([key]) => key);
  }
}
