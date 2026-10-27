import {TThreadIds} from "../../contracts";
import {
  ITraceEntry,
  ITraceFilters,
  ITraceRepository,
} from "../../internal/trace";

import {makeTenantKey} from "./utils/makeTenantKey";

/**
 * Trace entries in a Map, one per traceId (saving again replaces it).
 * Copies in and out, like a database; queries keep insertion order; `from` and `to` are inclusive.
 */
export class InMemoryTraceRepository implements ITraceRepository {
  private readonly entries = new Map<string, ITraceEntry>();

  public async save(
    {entry}: {entry: ITraceEntry},
  ): Promise<void> {
    this.entries.set(makeTenantKey(entry.tenantId, entry.id), structuredClone(entry));
  }

  public async load(
    {
      tenantId,
      traceId,
    }: {
      tenantId: string;
      traceId: string;
    },
  ): Promise<ITraceEntry | null> {
    const entry = this.entries.get(makeTenantKey(tenantId, traceId));
    return entry ? structuredClone(entry) : null;
  }

  public async query(
    {
      tenantId,
      filters,
      skip,
      limit,
    }: {
      tenantId: string;
      filters: ITraceFilters;
      skip: number;
      limit: number;
    },
  ): Promise<ITraceEntry[]> {
    return [...this.entries.values()]
      .filter(entry => entry.tenantId === tenantId)
      .filter(entry => this.matches(entry, filters))
      .slice(skip, skip + limit)
      .map(entry => structuredClone(entry));
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
    const keys = [...this.entries.entries()]
      .filter(([, entry]) =>
        entry.tenantId === tenantId
        && (userId === undefined || entry.userId === userId)
        && (threadIds === "all" || (entry.threadId !== undefined && threadIds.includes(entry.threadId))))
      .map(([key]) => key);
    for (const key of keys) this.entries.delete(key);
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
      const entry = this.entries.get(key);
      if (!entry) continue;
      this.entries.set(key, {
        ...entry,
        userId: pseudonym,
        request: undefined,
        result: undefined,
      });
    }
    return keys.length;
  }

  private getKeysOfUser(tenantId: string, userId: string): string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.tenantId === tenantId && entry.userId === userId)
      .map(([key]) => key);
  }

  private matches(entry: ITraceEntry, filters: ITraceFilters): boolean {
    if (filters.userId !== undefined && entry.userId !== filters.userId) return false;
    if (filters.threadId !== undefined && entry.threadId !== filters.threadId) return false;
    if (filters.kind !== undefined && entry.kind !== filters.kind) return false;
    if (filters.from !== undefined && entry.createdAt.getTime() < filters.from.getTime()) return false;
    if (filters.to !== undefined && entry.createdAt.getTime() > filters.to.getTime()) return false;
    return true;
  }
}
