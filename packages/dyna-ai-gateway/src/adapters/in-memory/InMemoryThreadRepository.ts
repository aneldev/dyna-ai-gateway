import {dynaError} from "dyna-error";

import {
  IPage,
  IPageArgs,
  ITurn,
  TThreadIds,
} from "../../contracts";
import {
  IThread,
  IThreadCounts,
  IThreadRepository,
  EThreadStatus,
} from "../../internal/thread-store";

import {makeTenantKey} from "./utils/makeTenantKey";

/**
 * InMemoryThreadRepository -- the thread repository in Maps, for tests and the sandbox
 *
 * # About
 *
 * > Behaves like a database without one: copies in and out, turns in insertion order.
 *
 * Implements `IThreadRepository` so the `ThreadStore` runs with no infrastructure. The threads and their turns are two
 * Maps keyed by tenant + id; the thread list is newest first by `createdAt`, then by id (D37). `acquireLease` is atomic
 * by construction: one synchronous read and write with no await between them.
 *
 * # Who needs it
 *
 * The gateway tests (`gatewayConfigBase`), the dev sandbox and the cookbook's first run; a host app uses its own adapter.
 *
 * # Pitfalls
 *
 * Production: nothing survives the process, nothing is shared between processes.
 */
export class InMemoryThreadRepository implements IThreadRepository {
  private readonly threads = new Map<string, IThread>();
  private readonly turns = new Map<string, ITurn[]>();

  /**
   * saveThread -- inserts or replaces the thread
   *
   * # About
   *
   * > By `thread.id` within `thread.tenantId`; the turns are not part of it.
   *
   * The thread record whole: title, status, working memory, lease, dates.
   *
   * # Who needs it
   *
   * `ThreadStore.createThread`, `updateThread`, `appendTurn` (the counts), `setWorkingMemory`.
   */
  public async saveThread(
    {thread}: {thread: IThread},
  ): Promise<void> {
    this.threads.set(makeTenantKey(thread.tenantId, thread.id), structuredClone(thread));
  }

  /**
   * loadThread -- the thread of a tenant by id
   *
   * # About
   *
   * > As stored, `deletedAt` included; null when the tenant has no thread with this id.
   *
   * The thread record whole, without its turns.
   *
   * # Who needs it
   *
   * `ThreadStore.getThread` and `findThread`.
   */
  public async loadThread(
    {
      tenantId,
      threadId,
    }: {
      tenantId: string;
      threadId: string;
    },
  ): Promise<IThread | null> {
    const thread = this.threads.get(makeTenantKey(tenantId, threadId));
    return thread ? structuredClone(thread) : null;
  }

  /**
   * listThreads -- one page of a user's threads
   *
   * # About
   *
   * > Newest first by `createdAt`, the id as the tie-break (D37); the cursors are thread ids.
   *
   * A thread whose `deletedAt` is set is not listed. `endingBefore` reads the `limit` threads older than it, `startingAfter`
   * the `limit` threads right after it (the page next to the cursor, not the newest). A cursor that is not a listed thread of
   * this user is a 404. The store has validated `limit` and that only one cursor is set.
   *
   * # Who needs it
   *
   * `ThreadStore.listThreads`.
   */
  public async listThreads(
    {
      tenantId,
      userId,
      page: {
        limit,
        startingAfter,
        endingBefore,
      },
    }: {
      tenantId: string;
      userId: string;
      page: IPageArgs;
    },
  ): Promise<IPage<IThread>> {
    const listed = [...this.threads.values()]
      .filter(thread => thread.tenantId === tenantId && thread.userId === userId && thread.deletedAt === null)
      .sort(compareNewestFirst);
    const cursorId = startingAfter ?? endingBefore;
    const cursor = cursorId === null ? null : listed.find(thread => thread.id === cursorId);
    if (cursorId !== null && !cursor) {
      throw dynaError({
        code: 5379462948293,
        status: 404,
        message: `InMemoryThreadRepository: cursor thread [${cursorId}] is not a thread of user [${userId}]`,
        data: {
          tenantId,
          userId,
          threadId: cursorId,
        },
      });
    }
    const newestFirst = cursor
      ? listed.filter(thread => startingAfter !== null
        ? compareNewestFirst(thread, cursor) < 0
        : compareNewestFirst(thread, cursor) > 0)
      : listed;
    // Reading newer than a cursor walks up from it: the page is the `limit` items next to the cursor, not the newest ones
    const items = startingAfter === null
      ? newestFirst.slice(0, limit)
      : newestFirst.slice(-limit);
    return {
      items: structuredClone(items),
      hasMore: newestFirst.length > limit,
    };
  }

  /**
   * appendTurn -- stores one turn at the end of the thread
   *
   * # About
   *
   * > The order of appending is the order `loadTurns` returns.
   *
   * The turn whole: role, parts, dates. The thread's counts are the store's, saved with `saveThread`.
   *
   * # Who needs it
   *
   * `ThreadStore.appendTurn`.
   */
  public async appendTurn(
    {
      tenantId,
      threadId,
      turn,
    }: {
      tenantId: string;
      threadId: string;
      turn: ITurn;
    },
  ): Promise<void> {
    const key = makeTenantKey(tenantId, threadId);
    this.turns.set(key, [...this.turns.get(key) ?? [], structuredClone(turn)]);
  }

  /**
   * loadTurns -- a slice of the thread's turns
   *
   * # About
   *
   * > In the order they were appended, reversed when `desc`; `skip` and `limit` cut it.
   *
   * The turns whole, as stored.
   *
   * # Who needs it
   *
   * `ThreadStore.getTurns` and `getLastTurns`.
   */
  public async loadTurns(
    {
      tenantId,
      threadId,
      desc,
      skip,
      limit,
    }: {
      tenantId: string;
      threadId: string;
      /** Newest first when true. */
      desc: boolean;
      skip: number;
      limit: number;
    },
  ): Promise<ITurn[]> {
    const turns = [...this.turns.get(makeTenantKey(tenantId, threadId)) ?? []];
    if (desc) turns.reverse();
    return structuredClone(turns.slice(skip, skip + limit));
  }

  /**
   * listThreadIds -- the ids of the tenant's threads
   *
   * # About
   *
   * > Of one user when `userId` is given; deleted threads excluded.
   *
   * The ids only, in any order, for a bulk operation over every thread.
   *
   * # Who needs it
   *
   * `ThreadStore.listThreadIds`, for the gateway's `delete` with `"all"`.
   */
  public async listThreadIds(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId?: string;
    },
  ): Promise<string[]> {
    return [...this.threads.values()]
      .filter(thread => thread.tenantId === tenantId && (userId === undefined || thread.userId === userId) && thread.deletedAt === null)
      .map(thread => thread.id);
  }

  /**
   * delete -- hard-deletes threads with their turns and working memory
   *
   * # About
   *
   * > The listed ids, or every thread of the tenant for `"all"`.
   *
   * Narrowed to one user when `userId` is given. An unknown id or one of another tenant or user is ignored. Returns the
   * counts of the threads and of the turns deleted.
   *
   * # Who needs it
   *
   * `ThreadStore.delete`, for the gateway's `delete` and `deleteUserData`.
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
  ): Promise<IThreadCounts> {
    const keys = [...this.threads.entries()]
      .filter(([, thread]) =>
        thread.tenantId === tenantId
        && (userId === undefined || thread.userId === userId)
        && (threadIds === "all" || threadIds.includes(thread.id)))
      .map(([key]) => key);
    const counts = this.removeTurns(keys);
    for (const key of keys) this.threads.delete(key);
    return counts;
  }

  /**
   * anonymizeByUser -- keeps a user's threads as skeletons
   *
   * # About
   *
   * > GDPR pseudonymisation: the words go, the record stays.
   *
   * `userId` becomes the pseudonym, the title and the working memory are emptied, the status becomes CLOSED, the turns are
   * deleted; id, turnCount and dates stay. Returns how many of each.
   *
   * # Who needs it
   *
   * `ThreadStore.anonymizeByUser`, for the gateway's `anonymizeUserData`.
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
  ): Promise<IThreadCounts> {
    const counts = this.removeTurns(this.getKeysOfUser(tenantId, userId));
    for (const key of this.getKeysOfUser(tenantId, userId)) {
      const thread = this.threads.get(key);
      if (!thread) continue;
      this.threads.set(key, {
        ...thread,
        userId: pseudonym,
        title: "",
        status: EThreadStatus.CLOSED,
        workingMemory: {
          summary: "",
          facts: {},
          updatedAtTurn: 0,
        },
      });
    }
    return counts;
  }

  /**
   * acquireLease -- takes the thread's lease atomically
   *
   * # About
   *
   * > Check-and-set (D77): one caller at a time on a thread.
   *
   * Sets the lease to `{token, expiresAt}` and returns true only when the thread has no lease or its lease has expired at
   * `now`; otherwise changes nothing and returns false. One database operation (Mongo: `findOneAndUpdate` with the condition
   * in the filter), never a load followed by a save.
   *
   * # Who needs it
   *
   * `ThreadStore.acquireLease`, before every call on a thread.
   */
  public async acquireLease(
    {
      tenantId,
      threadId,
      token,
      expiresAt,
      now,
    }: {
      tenantId: string;
      threadId: string;
      token: string;
      expiresAt: Date;
      now: Date;
    },
  ): Promise<boolean> {
    const key = makeTenantKey(tenantId, threadId);
    const thread = this.threads.get(key);
    if (!thread) return false;
    if (thread.lease && thread.lease.expiresAt > now) return false;
    this.threads.set(key, {
      ...thread,
      lease: {
        token,
        expiresAt,
      },
    });
    return true;
  }

  /**
   * releaseLease -- gives the thread's lease back
   *
   * # About
   *
   * > Only the holder's token clears it.
   *
   * Clears the lease when it carries this `token`; a lease another call took meanwhile stays.
   *
   * # Who needs it
   *
   * `ThreadStore.releaseLease`, when the call ends.
   */
  public async releaseLease(
    {
      tenantId,
      threadId,
      token,
    }: {
      tenantId: string;
      threadId: string;
      token: string;
    },
  ): Promise<void> {
    const key = makeTenantKey(tenantId, threadId);
    const thread = this.threads.get(key);
    if (!thread || thread.lease?.token !== token) return;
    this.threads.set(key, {
      ...thread,
      lease: null,
    });
  }

  /** The Map keys of the user's threads. */
  private getKeysOfUser(tenantId: string, userId: string): string[] {
    return [...this.threads.entries()]
      .filter(([, thread]) => thread.tenantId === tenantId && thread.userId === userId)
      .map(([key]) => key);
  }

  /** Deletes the turns of the threads under `keys`; returns the thread and turn counts. */
  private removeTurns(keys: string[]): IThreadCounts {
    const turns = keys.reduce((sum, key) => sum + (this.turns.get(key)?.length ?? 0), 0);
    for (const key of keys) this.turns.delete(key);
    return {
      threads: keys.length,
      turns,
    };
  }
}

/**
 * Newest `createdAt` first; the id breaks a tie.
 * A page border between two threads of the same millisecond is then stable.
 */
const compareNewestFirst = (a: IThread, b: IThread): number =>
  b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);
