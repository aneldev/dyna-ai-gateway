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

/**
 * ThreadStore -- the database owner of the conversations: threads and their turns
 *
 * # About
 *
 * > Pure storage, in the gateway's own format: any model can continue any thread.
 *
 * Holds the threads of every tenant and the turns of every thread, with no model and no prompt text inside. The gateway
 * appends the user turn before the model call and the assistant turns after it, so a crash between the two leaves a
 * visible, honest state. The working-memory fields live on the thread but are written only through the WorkingMemory.
 *
 * - Tenant-scoped: every method takes `tenantId`, and a thread of another tenant is a 404.
 * - One call at a time on a thread: the lease (D77), taken before the user turn is stored and released in a `finally`.
 * - Two reads of the same turns: `getLastTurns` is the model's window (the working memory), `getTurns` the screen's
 *   whole history; `listThreads` pages a user's threads as the Vercel chat client does (D37).
 * - Deletes are hard and in bulk (D119); a thread whose repository set `deletedAt` reads as gone.
 *
 * Created by `createGatewayDeps` early: the WorkingMemory depends on it. Read and written on every call (`prepareCall`,
 * `settleRun`, `closeRun`) and by the thread methods of the facade.
 *
 * # Who needs it
 *
 * `prepareCall`, `withThreadLease`, `appendTurns`, `settleRun`, `settleReview`, `settleReviewPause`, `closeRun`,
 * `updateMemory`, `forgetUser`, `deleteThreads`, `getOwnThread`; `WorkingMemory` for the window and the memory state;
 * the facade's `listThreads`, `getTurns`, `renameThread`, `recoverStuckRuns`.
 *
 * # What needs
 *
 * `IThreadStoreConfig`: the `IThreadRepository` and the optional `leaseMs`.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Anything that reads or writes a conversation as stored.
 *
 * ## When shouldn't use it
 *
 * The turns as the model sees them: that is `TurnBuilder.toMessages` through the WorkingMemory. The runs of a thread: the RunStore.
 *
 * # Pitfalls
 *
 * Every method but `findThread`, `listThreadIds`, `delete` and `anonymizeByUser` throws a 404 for a thread that is missing,
 * deleted or of another tenant. `appendTurn` is two repository writes (the turn, then the thread's count); the turns of one
 * answer are appended in order, and the repository keeps that order.
 */
export class ThreadStore implements IThreadStore {
  constructor(private readonly config: IThreadStoreConfig) {}

  /**
   * createThread -- a new, empty conversation of a user
   *
   * # About
   *
   * > OPEN, no turns, no memory, no lease; the id is the gateway's.
   *
   * Saves the thread and returns a copy. The title stays empty unless given.
   *
   * # Who needs it
   *
   * `prepareCall`, for a call without a `threadId` (step 3).
   */
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

  /**
   * getThread -- one thread of a tenant, or a 404
   *
   * # About
   *
   * > The read every other method starts with.
   *
   * A thread that is missing, deleted (`deletedAt` set) or of another tenant is the same 404 (`5372567786151`); `findThread`
   * is the twin that returns null instead. The ownership by the user is not checked here: that is `getOwnThread` (D32).
   *
   * # Who needs it
   *
   * `getOwnThread`, `prepareCall` (read again under the lease, for the status), `closeRun`, `updateMemory`, `WorkingMemory`,
   * `AIGateway.continueRun` and `continueReview` (the turn count before a step).
   */
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

  /**
   * appendTurn -- stores one turn at the end of a thread
   *
   * # About
   *
   * > The turn, then the thread's `turnCount` and `updatedAt`.
   *
   * Two repository writes, in that order. The turns of one answer are appended one after the other by `appendTurns`, so the
   * repository's order is the order of the conversation.
   *
   * # Who needs it
   *
   * `appendTurns`, the one writer of turns in the gateway.
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

  /**
   * getLastTurns -- the newest turns of a thread, oldest first
   *
   * # About
   *
   * > The model's window on the conversation.
   *
   * Reads the newest `limit` turns and returns them in chronological order. The WorkingMemory reads the window of a call
   * with it (D122); `closeRun` the turns a run could have stored; `updateMemory` the turns since the last fact extraction.
   *
   * # Who needs it
   *
   * `WorkingMemory`, `closeRun`, `updateMemory`, `deleteThreads`.
   */
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

  /**
   * updateThread -- changes the title or the status of a thread
   *
   * # About
   *
   * > What is omitted stays; `updatedAt` moves.
   *
   * The status is the gateway's: AWAITING_HUMAN when a run pauses, OPEN again when it settles or closes. The title is the
   * user's (`AIGateway.renameThread`).
   *
   * # Who needs it
   *
   * `settleRun`, `settleReviewPause`, `settleReview`, `closeRun` (the status); `AIGateway.renameThread` (the title).
   */
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

  /**
   * setWorkingMemory -- stores the working memory of a thread
   *
   * # About
   *
   * > The WorkingMemory's write; the thread's `updatedAt` stays, memory is not activity of the user.
   *
   * Replaces the state whole (a copy of it).
   *
   * # Who needs it
   *
   * `WorkingMemory` only: its `saveContext` and `reset`.
   */
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

  /**
   * findThread -- one thread of a tenant, or null
   *
   * # About
   *
   * > `getThread` without the 404, for a caller that asks "is it there".
   *
   * Null for a thread that is missing, deleted or of another tenant.
   *
   * # Who needs it
   *
   * `forgetUser` and `deleteThreads`, to read the lease of each thread before they write.
   */
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

  /**
   * listThreadIds -- the ids of a tenant's threads, or of one user's
   *
   * # About
   *
   * > Every live thread, by id only, for the bulk operations.
   *
   * Deleted threads are excluded. No paging: the bulk operations (D119, D54) walk the whole list.
   *
   * # Who needs it
   *
   * `forgetUser` and `deleteThreads`, to find the threads whose lease they must check.
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
    return this.config.repository.listThreadIds({
      tenantId,
      userId,
    });
  }

  /**
   * delete -- hard-deletes threads with their turns and working memory (D119)
   *
   * # About
   *
   * > The listed ids, or every thread of the tenant for `"all"`, narrowed to one user when `userId` is given.
   *
   * An unknown id, or one of another tenant or user, is ignored. Returns how many threads and turns went. The runs, the
   * trace entries and the files of the threads are the callers' business (`deleteThreads`).
   *
   * # Who needs it
   *
   * `deleteThreads` (the facade's `delete`) and `forgetUser` (the DELETE mode, D54).
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
    return this.config.repository.delete({
      tenantId,
      threadIds,
      userId,
    });
  }

  /**
   * anonymizeByUser -- keeps a user's threads as skeletons under a pseudonym (D54)
   *
   * # About
   *
   * > What identifies the person goes, what counts stays.
   *
   * `userId` becomes the pseudonym, the title and the working memory are emptied, the status becomes CLOSED, the turns are
   * deleted; id, `turnCount` and the dates stay for the statistics. Returns how many threads and turns were touched.
   *
   * # Who needs it
   *
   * `forgetUser`, in the ANONYMIZE mode (`AIGateway.anonymizeUserData`).
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
