import {dynaError} from "dyna-error";
import {randomUUID} from "node:crypto";

import {
  IPage,
  IPageArgs,
  ITurn,
  TThreadIds,
} from "../../contracts";

import {IWorkingMemoryState} from "../working-memory";

import {
  IThread,
  IThreadStore,
  IThreadStoreConfig,
  IThreadCounts,
  EThreadStatus,
} from "./types";

/** How long a call may hold a thread when the config names no `leaseMs`. */
const DEFAULT_LEASE_MS = 300_000;

/** The most threads one `listThreads` returns (D37). */
const MAX_PAGE_LIMIT = 200;

/** Tenant-scoped storage of threads and turns. */
export class ThreadStore implements IThreadStore {
  constructor(private readonly config: IThreadStoreConfig) {}

  /** Creates an empty thread. */
  public async createThread(
    {
      tenantId,
      userId,
      title = "",
    }: {
      tenantId: string;
      userId: string;
      /** Optional; WorkingMemory/THREAD_TITLE can fill it later. */
      title?: string;
    },
  ): Promise<IThread> {
    const now = new Date();
    const thread: IThread = {
      id: randomUUID(),
      tenantId,
      userId,
      title,
      status: EThreadStatus.OPEN,
      workingMemory: {
        summary: "",
        facts: {},
        updatedAtTurn: 0,
      },
      turnCount: 0,
      lease: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.config.repository.saveThread({thread});
    return structuredClone(thread);
  }

  /**
   * acquireLease -- marks the thread busy for one call
   *
   * # About
   *
   * > One call at a time on a thread.
   *
   * Takes the thread's lease (D77) for `leaseMs` and returns the token that releases it. A thread whose lease is held and not
   * expired is a 409: the caller tells the user the thread is busy and does not store anything.
   *
   * `AIGateway` calls it before a call on an existing thread stores its user turn, and `releaseLease` in a `finally`.
   *
   * # Pitfalls
   *
   * The lease expires by itself: a call longer than `leaseMs` runs unprotected at its end. Size `leaseMs` for the longest run.
   */
  public async acquireLease(
    {
      tenantId,
      threadId,
    }: {
      tenantId: string;
      threadId: string;
    },
  ): Promise<string> {
    await this.getThread({
      tenantId,
      threadId,
    });
    const now = new Date();
    const token = randomUUID();
    const acquired = await this.config.repository.acquireLease({
      tenantId,
      threadId,
      token,
      expiresAt: new Date(now.getTime() + (this.config.leaseMs ?? DEFAULT_LEASE_MS)),
      now,
    });
    if (!acquired) {
      throw dynaError({
        code: 5375384011263,
        status: 409,
        message: `ThreadStore: thread [${threadId}] is busy with another call`,
        userMessage: "This conversation is still answering, please wait for it to finish",
        data: {
          tenantId,
          threadId,
        },
      });
    }
    return token;
  }

  /**
   * releaseLease -- frees the thread after a call
   *
   * # About
   *
   * > Gives back what `acquireLease` gave out.
   *
   * Clears the lease that carries `token`. A lease another call took after this one expired stays: the late release of a
   * call that overran never frees a thread someone else holds.
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
    await this.config.repository.releaseLease({
      tenantId,
      threadId,
      token,
    });
  }

  /** Loads a thread; throws if missing, soft-deleted or not owned by the tenant. */
  public async getThread(
    {
      tenantId,
      threadId,
    }: {
      tenantId: string;
      threadId: string;
    },
  ): Promise<IThread> {
    const thread = await this.config.repository.loadThread({
      tenantId,
      threadId,
    });
    if (!thread || thread.deletedAt !== null) {
      throw dynaError({
        code: 5372567786151,
        status: 404,
        message: `ThreadStore: unknown thread [${threadId}] for tenant [${tenantId}]`,
        userMessage: "Not found or it is deleted",
        data: {
          tenantId,
          threadId,
        },
      });
    }
    return thread;
  }

  /**
   * listThreads -- one page of a user's threads for the sidebar of a chat screen
   *
   * # About
   *
   * > The conversations of one user, newest first, paged by cursor.
   *
   * Pages as the Vercel chat client does (D37): the first read passes both cursors null and gets the newest `limit` threads;
   * `endingBefore` a thread id reads the older ones (the next page), `startingAfter` the newer ones. Deleted threads are left out.
   *
   * `AIGateway.listThreads` calls it with the tenant and user of the call.
   *
   * # Pitfalls
   *
   * `limit` outside 1–200 or both cursors at once is a 400; a cursor that is not a thread of this user is the repository's 404.
   * The order is by `createdAt`: a thread used again keeps its place, it does not move to the top.
   */
  public async listThreads(
    {
      tenantId,
      userId,
      page,
    }: {
      tenantId: string;
      userId: string;
      page: IPageArgs;
    },
  ): Promise<IPage<IThread>> {
    if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > MAX_PAGE_LIMIT) {
      throw dynaError({
        code: 5379462948271,
        status: 400,
        message: `ThreadStore: limit must be an integer from 1 to ${MAX_PAGE_LIMIT}, got [${page.limit}]`,
        data: {
          tenantId,
          userId,
          limit: page.limit,
        },
      });
    }
    if (page.startingAfter !== null && page.endingBefore !== null) {
      throw dynaError({
        code: 5379462948282,
        status: 400,
        message: "ThreadStore: startingAfter and endingBefore cannot be used together",
        data: {
          tenantId,
          userId,
          startingAfter: page.startingAfter,
          endingBefore: page.endingBefore,
        },
      });
    }
    return this.config.repository.listThreads({
      tenantId,
      userId,
      page,
    });
  }

  /** Appends one turn and bumps turnCount/updatedAt. */
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
    const thread = await this.getThread({
      tenantId,
      threadId,
    });
    await this.config.repository.appendTurn({
      tenantId,
      threadId,
      turn,
    });
    await this.config.repository.saveThread({
      thread: {
        ...thread,
        turnCount: thread.turnCount + 1,
        updatedAt: new Date(),
      },
    });
  }

  /** Last N turns in chronological order; feeds the ContextAssembler. */
  public async getLastTurns(
    {
      tenantId,
      threadId,
      limit,
    }: {
      tenantId: string;
      threadId: string;
      limit: number;
    },
  ): Promise<ITurn[]> {
    await this.getThread({
      tenantId,
      threadId,
    });
    const newestFirst = await this.config.repository.loadTurns({
      tenantId,
      threadId,
      desc: true,
      skip: 0,
      limit,
    });
    return newestFirst.reverse();
  }

  /**
   * getTurns -- the whole history of a thread for a chat screen
   *
   * # About
   *
   * > Every turn of the thread, oldest first, in one read.
   *
   * A thread's history is loaded whole, as the Vercel chat client loads a chat (D37): no paging. `getLastTurns` is the model's
   * window on the same turns; this one is the screen's.
   *
   * `AIGateway.getTurns` calls it after it checked that the thread is the caller's.
   *
   * # Pitfalls
   *
   * A conversation of thousands of turns is one large read and one large payload.
   */
  public async getTurns(
    {
      tenantId,
      threadId,
    }: {
      tenantId: string;
      threadId: string;
    },
  ): Promise<ITurn[]> {
    const thread = await this.getThread({
      tenantId,
      threadId,
    });
    if (!thread.turnCount) return [];
    return this.config.repository.loadTurns({
      tenantId,
      threadId,
      desc: false,
      skip: 0,
      limit: thread.turnCount,
    });
  }

  /** Changes title and/or status (and updatedAt); what is omitted stays. */
  public async updateThread(
    {
      tenantId,
      threadId,
      title,
      status,
    }: {
      tenantId: string;
      threadId: string;
      title?: string;
      status?: EThreadStatus;
    },
  ): Promise<void> {
    const thread = await this.getThread({
      tenantId,
      threadId,
    });
    await this.config.repository.saveThread({
      thread: {
        ...thread,
        title: title ?? thread.title,
        status: status ?? thread.status,
        updatedAt: new Date(),
      },
    });
  }

  /** Called by WorkingMemory only. The thread's updatedAt stays: memory is not activity of the user. */
  public async setWorkingMemory(
    {
      tenantId,
      threadId,
      state,
    }: {
      tenantId: string;
      threadId: string;
      state: IWorkingMemoryState;
    },
  ): Promise<void> {
    const thread = await this.getThread({
      tenantId,
      threadId,
    });
    await this.config.repository.saveThread({
      thread: {
        ...thread,
        workingMemory: structuredClone(state),
      },
    });
  }

  /** Loads a thread of the tenant, or null when it is missing or deleted; `getThread` is the throwing twin. */
  public async findThread(
    {
      tenantId,
      threadId,
    }: {
      tenantId: string;
      threadId: string;
    },
  ): Promise<IThread | null> {
    const thread = await this.config.repository.loadThread({
      tenantId,
      threadId,
    });
    return thread && thread.deletedAt === null ? thread : null;
  }

  /** The ids of the tenant's threads, of one user when `userId` is given. */
  public async listThreadIds(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId?: string;
    },
  ): Promise<string[]> {
    return this.config.repository.listThreadIds({
      tenantId,
      userId,
    });
  }

  /** Hard-deletes threads with their turns and working memory: the listed ids or `"all"`, of one user when `userId` is given. Returns how many of each. */
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
    return this.config.repository.delete({
      tenantId,
      threadIds,
      userId,
    });
  }

  /**
   * Keeps every thread of a user as a skeleton under the pseudonym (GDPR pseudonymisation): no title, no memory, no turns,
   * status CLOSED; id, turnCount and dates stay for the statistics. Returns how many of each.
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
    return this.config.repository.anonymizeByUser({
      tenantId,
      userId,
      pseudonym,
    });
  }
}
