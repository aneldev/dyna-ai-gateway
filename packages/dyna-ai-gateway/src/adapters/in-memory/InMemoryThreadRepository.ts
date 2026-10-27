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
 * Threads and their turns in Maps. Copies in and out, like a database.
 * Turns keep insertion order; the thread list is newest first by `createdAt`, then by id (D37).
 */
export class InMemoryThreadRepository implements IThreadRepository {
  private readonly threads = new Map<string, IThread>();
  private readonly turns = new Map<string, ITurn[]>();

  public async saveThread(
    {thread}: {thread: IThread},
  ): Promise<void> {
    this.threads.set(makeTenantKey(thread.tenantId, thread.id), structuredClone(thread));
  }

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

  private getKeysOfUser(tenantId: string, userId: string): string[] {
    return [...this.threads.entries()]
      .filter(([, thread]) => thread.tenantId === tenantId && thread.userId === userId)
      .map(([key]) => key);
  }

  /** Deletes the turns of the threads under `keys`; returns the counts of the threads and of the turns deleted. */
  private removeTurns(keys: string[]): IThreadCounts {
    const turns = keys.reduce((sum, key) => sum + (this.turns.get(key)?.length ?? 0), 0);
    for (const key of keys) this.turns.delete(key);
    return {
      threads: keys.length,
      turns,
    };
  }
}

/** Newest `createdAt` first; the id breaks a tie, so a page border between two threads of one millisecond is stable. */
const compareNewestFirst = (a: IThread, b: IThread): number =>
  b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);
