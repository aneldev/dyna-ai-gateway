import {TThreadIds} from "../../contracts";
import {
  ITraceEntry,
  ITraceFilters,
  ITraceRepository,
} from "../../internal/trace";

import {makeTenantKey} from "./utils/makeTenantKey";

/**
 * InMemoryTraceRepository -- the trace repository in a Map, for tests and the sandbox
 *
 * # About
 *
 * > Behaves like a database without one: copies in and out, queries in insertion order.
 *
 * Implements `ITraceRepository` so the `Trace` runs with no infrastructure. One entry per tenant + trace id, saving again
 * replaces it; `from` and `to` are inclusive. The raw request and result are kept: a test reads what the model was sent.
 *
 * # Who needs it
 *
 * The gateway tests (`gatewayConfigBase`), the dev sandbox and the cookbook's first run; a host app uses its own adapter.
 *
 * # Pitfalls
 *
 * Production: nothing survives the process, nothing is shared between processes.
 */
export class InMemoryTraceRepository implements ITraceRepository {
  private readonly entries = new Map<string, ITraceEntry>();

  /**
   * save -- inserts or replaces one entry
   *
   * # About
   *
   * > Upsert by `entry.id` within the tenant.
   *
   * The entry whole. A repository that must not keep the raw request or result drops them here.
   *
   * # Who needs it
   *
   * `Trace.record`, for every model call; `Trace.annotate`, to write the entry back.
   */
  public async save(
    {entry}: {entry: ITraceEntry},
  ): Promise<void> {
    this.entries.set(makeTenantKey(entry.tenantId, entry.id), structuredClone(entry));
  }

  /**
   * load -- one entry by id
   *
   * # About
   *
   * > Null when the tenant has no entry with this id.
   *
   * The entry as stored, whole.
   *
   * # Who needs it
   *
   * `Trace.annotate`, before it merges the gateway's facts into the entry.
   */
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

  /**
   * query -- the entries of a tenant, filtered and paged
   *
   * # About
   *
   * > What matches `ITraceFilters`, from `skip`, at most `limit`.
   *
   * User, thread, kind and the inclusive `from` / `to` dates narrow the set; the order is the adapter's.
   *
   * # Who needs it
   *
   * `Trace.query`, for the host's audit pages.
   */
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

  /**
   * delete -- hard-deletes the entries of threads
   *
   * # About
   *
   * > `"all"`: every entry of the tenant, the ones without a thread included.
   *
   * Narrowed to one user when `userId` is given. Returns how many went.
   *
   * # Who needs it
   *
   * `Trace.delete`, for the gateway's `delete` and `deleteUserData` (D54, D119).
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
    const keys = [...this.entries.entries()]
      .filter(([, entry]) =>
        entry.tenantId === tenantId
        && (userId === undefined || entry.userId === userId)
        && (threadIds === "all" || (entry.threadId !== undefined && threadIds.includes(entry.threadId))))
      .map(([key]) => key);
    for (const key of keys) this.entries.delete(key);
    return keys.length;
  }

  /**
   * anonymizeByUser -- keeps a user's entries as an audit skeleton
   *
   * # About
   *
   * > GDPR pseudonymisation: the numbers stay, the words go.
   *
   * `userId` becomes the pseudonym, `request` and `result` are removed; usage, cost, model, kind, chunk ids, issues and dates
   * stay. Returns how many.
   *
   * # Who needs it
   *
   * `Trace.anonymizeByUser`, for the gateway's `anonymizeUserData` (D54).
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

  /** The Map keys of the user's entries. */
  private getKeysOfUser(tenantId: string, userId: string): string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.tenantId === tenantId && entry.userId === userId)
      .map(([key]) => key);
  }

  /** True when the entry passes every filter that is set. */
  private matches(entry: ITraceEntry, filters: ITraceFilters): boolean {
    if (filters.userId !== undefined && entry.userId !== filters.userId) return false;
    if (filters.threadId !== undefined && entry.threadId !== filters.threadId) return false;
    if (filters.kind !== undefined && entry.kind !== filters.kind) return false;
    if (filters.from !== undefined && entry.createdAt.getTime() < filters.from.getTime()) return false;
    if (filters.to !== undefined && entry.createdAt.getTime() > filters.to.getTime()) return false;
    return true;
  }
}
