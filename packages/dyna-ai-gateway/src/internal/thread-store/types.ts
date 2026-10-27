import {
  IPage,
  IPageArgs,
  ITurn,
  TThreadIds,
} from "../../contracts";

import {IWorkingMemoryState} from "../working-memory";

/** Configuration of the ThreadStore. Lands in IAIGatewayConfig.threadStore. */
export interface IThreadStoreConfig {
  /** Persistence; Mongo in v1. */
  repository: IThreadRepository;
  /**
   * How long a call holds a thread before its lease expires by itself (D77).
   *
   * > A server that dies mid-call must not leave the thread busy for ever.
   *
   * Size it for the longest call: `maxStepsPerRun` steps of a model call plus a tool timeout each.
   *
   * @example 300_000 - six steps of up to 30 s tool time and a slow model still fit
   *
   * @default 300_000
   */
  leaseMs?: number;
}

/**
 * Tenant-scoped storage of threads and turns.
 *
 * Implemented by `ThreadStore`; the type of `IAIGatewayDeps.threadStore`, so a host may pass its own in `overrides`.
 */
export interface IThreadStore {
  /** Creates an empty thread. */
  createThread(args: {
    tenantId: string;
    userId: string;
    /** Optional; WorkingMemory/THREAD_TITLE can fill it later. */
    title?: string;
  }): Promise<IThread>;

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
  acquireLease(args: {
    tenantId: string;
    threadId: string;
  }): Promise<string>;

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
  releaseLease(args: {
    tenantId: string;
    threadId: string;
    token: string;
  }): Promise<void>;

  /** Loads a thread; throws if missing, soft-deleted or not owned by the tenant. */
  getThread(args: {
    tenantId: string;
    threadId: string;
  }): Promise<IThread>;

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
  listThreads(args: {
    tenantId: string;
    userId: string;
    page: IPageArgs;
  }): Promise<IPage<IThread>>;

  /** Appends one turn and bumps turnCount/updatedAt. */
  appendTurn(args: {
    tenantId: string;
    threadId: string;
    turn: ITurn;
  }): Promise<void>;

  /** Last N turns in chronological order; feeds the ContextAssembler. */
  getLastTurns(args: {
    tenantId: string;
    threadId: string;
    limit: number;
  }): Promise<ITurn[]>;

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
  getTurns(args: {
    tenantId: string;
    threadId: string;
  }): Promise<ITurn[]>;

  /** Changes title and/or status (and updatedAt); what is omitted stays. */
  updateThread(args: {
    tenantId: string;
    threadId: string;
    title?: string;
    status?: EThreadStatus;
  }): Promise<void>;

  /** Called by WorkingMemory only. The thread's updatedAt stays: memory is not activity of the user. */
  setWorkingMemory(args: {
    tenantId: string;
    threadId: string;
    state: IWorkingMemoryState;
  }): Promise<void>;

  /** Loads a thread of the tenant, or null when it is missing or deleted; `getThread` is the throwing twin. */
  findThread(args: {
    tenantId: string;
    threadId: string;
  }): Promise<IThread | null>;

  /** The ids of the tenant's threads, of one user when `userId` is given. */
  listThreadIds(args: {
    tenantId: string;
    userId?: string;
  }): Promise<string[]>;

  /** Hard-deletes threads with their turns and working memory: the listed ids or `"all"`, of one user when `userId` is given. Returns how many of each. */
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<IThreadCounts>;

  /**
   * Keeps every thread of a user as a skeleton under the pseudonym (GDPR pseudonymisation): no title, no memory, no turns,
   * status CLOSED; id, turnCount and dates stay for the statistics. Returns how many of each.
   */
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<IThreadCounts>;
}

/** Persistence seam. Only the store calls it. */
export interface IThreadRepository {
  saveThread(args: {thread: IThread}): Promise<void>;
  loadThread(args: {
    tenantId: string;
    threadId: string;
  }): Promise<IThread | null>;
  /**
   * One page of a user's threads, newest first by `createdAt` with the id as the tie-break (D37); a thread whose `deletedAt`
   * is set is not listed. The cursors are thread ids: `endingBefore` reads the `limit` threads older than it, `startingAfter`
   * the `limit` threads right after it (the page next to the cursor, not the newest). A cursor that is not a listed thread of
   * this user is a 404. The store has validated `limit` and that only one cursor is set.
   */
  listThreads(args: {
    tenantId: string;
    userId: string;
    page: IPageArgs;
  }): Promise<IPage<IThread>>;
  appendTurn(args: {
    tenantId: string;
    threadId: string;
    turn: ITurn;
  }): Promise<void>;
  loadTurns(args: {
    tenantId: string;
    threadId: string;
    /** Newest first when true. */
    desc: boolean;
    skip: number;
    limit: number;
  }): Promise<ITurn[]>;
  /** The ids of the tenant's threads, of one user when `userId` is given; deleted threads excluded. */
  listThreadIds(args: {
    tenantId: string;
    userId?: string;
  }): Promise<string[]>;
  /**
   * Hard-deletes the threads with their turns and working memory: the listed ids, or every thread of the tenant for `"all"`,
   * narrowed to one user when `userId` is given. An unknown id or one of another tenant or user is ignored. Returns the counts.
   */
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<IThreadCounts>;
  /**
   * Keeps the threads of a user as skeletons (GDPR pseudonymisation): `userId` becomes the pseudonym, the title and the working
   * memory are emptied, the status becomes CLOSED, the turns are deleted; id, turnCount and dates stay. Returns how many of each.
   */
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<IThreadCounts>;
  /**
   * Atomic check-and-set of the thread's lease (D77): sets it to `{token, expiresAt}` and returns true only when the thread
   * has no lease or its lease has expired at `now`; otherwise changes nothing and returns false.
   * One database operation (Mongo: `findOneAndUpdate` with the condition in the filter), never a load followed by a save.
   */
  acquireLease(args: {
    tenantId: string;
    threadId: string;
    token: string;
    expiresAt: Date;
    now: Date;
  }): Promise<boolean>;
  /** Clears the thread's lease when it carries this `token`; a lease another call took meanwhile stays. */
  releaseLease(args: {
    tenantId: string;
    threadId: string;
    token: string;
  }): Promise<void>;
}

/** What a "by user" operation of the repository touched. */
export interface IThreadCounts {
  threads: number;
  turns: number;
}

/** A conversation. Turns are stored separately (see ITurn in chapter 1). */
export interface IThread {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  status: EThreadStatus;
  /** Written by WorkingMemory only. */
  workingMemory: IWorkingMemoryState;
  turnCount: number;
  /** The call that runs on the thread now; null when none (D77). */
  lease: IThreadLease | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * The busy mark of a thread: one call at a time runs on it (D77). Stored on the thread, so it holds across servers and
 * outlives nothing: a lease whose `expiresAt` has passed counts as free.
 *
 * `ThreadStore.acquireLease` gives it out, `ThreadStore.releaseLease` takes it back; `AIGateway` holds it for the length of a call.
 */
export interface IThreadLease {
  /** Identifies the call that holds the lease; only it can release the lease. */
  token: string;
  expiresAt: Date;
}

/** Lifecycle of a thread. */
export enum EThreadStatus {
  OPEN = "OPEN",
  /** A run is paused for a human. */
  AWAITING_HUMAN = "AWAITING_HUMAN",
  CLOSED = "CLOSED",
}
