import {
  IPage,
  IPageArgs,
  ITurn,
  TThreadIds,
} from "../../contracts";

import {IWorkingMemoryState} from "../working-memory";

/** Configuration of the ThreadStore. Lands in IAIGatewayConfig.threadStore. */
export interface IThreadStoreConfig {
  /** Persistence of the threads and turns: the host's adapter (in memory for the tests and the first run, a database in production). */
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
  appendTurn(args: {
    tenantId: string;
    threadId: string;
    turn: ITurn;
  }): Promise<void>;

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
  updateThread(args: {
    tenantId: string;
    threadId: string;
    title?: string;
    status?: EThreadStatus;
  }): Promise<void>;

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
  setWorkingMemory(args: {
    tenantId: string;
    threadId: string;
    state: IWorkingMemoryState;
  }): Promise<void>;

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
  findThread(args: {
    tenantId: string;
    threadId: string;
  }): Promise<IThread | null>;

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
  listThreadIds(args: {
    tenantId: string;
    userId?: string;
  }): Promise<string[]>;

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
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<IThreadCounts>;

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
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<IThreadCounts>;
}

/** Persistence seam. Only the store calls it. */
export interface IThreadRepository {
  /** Inserts or replaces the thread, by `thread.id` within `thread.tenantId`; the turns are not part of it. */
  saveThread(args: {thread: IThread}): Promise<void>;
  /** The thread as stored, `deletedAt` included, or null when the tenant has no thread with this id. */
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
  /** Stores one turn at the end of the thread; the order of appending is the order `loadTurns` returns. */
  appendTurn(args: {
    tenantId: string;
    threadId: string;
    turn: ITurn;
  }): Promise<void>;
  /** A slice of the thread's turns in the order they were appended, reversed when `desc`; `skip` and `limit` cut it. */
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
  /** Threads deleted or pseudonymised. */
  threads: number;
  /** Turns deleted with them. */
  turns: number;
}

/** A conversation. Turns are stored separately (see ITurn in chapter 1). */
export interface IThread {
  /** The gateway's id of the thread (a UUID); what a call names in `threadId`. */
  id: string;
  /** The tenant the thread belongs to; every read is scoped to it. */
  tenantId: string;
  /** The user the thread belongs to (D32); a pseudonym after `anonymizeByUser` (D54). */
  userId: string;
  /** The user's title for the list; empty until `AIGateway.renameThread` sets it. */
  title: string;
  /** OPEN, AWAITING_HUMAN while a run is paused, CLOSED after a pseudonymisation. */
  status: EThreadStatus;
  /** Written by WorkingMemory only. */
  workingMemory: IWorkingMemoryState;
  /** How many turns the thread holds; bumped by `appendTurn`, read by the run memory (D36) and the fact extraction. */
  turnCount: number;
  /** The call that runs on the thread now; null when none (D77). */
  lease: IThreadLease | null;
  /** When the thread was created; the order of `listThreads`. */
  createdAt: Date;
  /** The last turn appended or the last title/status change; a memory write does not move it. */
  updatedAt: Date;
  /** Set by a host repository that soft-deletes; the gateway reads such a thread as gone and never sets it itself (D119 deletes hard). */
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
  /** When the lease frees itself (`leaseMs` after it was taken), should the call never release it. */
  expiresAt: Date;
}

/** Lifecycle of a thread. */
export enum EThreadStatus {
  /** The thread takes calls. */
  OPEN = "OPEN",
  /** A run is paused for a human. */
  AWAITING_HUMAN = "AWAITING_HUMAN",
  /** The thread takes no call any more; set by the pseudonymisation of its user (D54). */
  CLOSED = "CLOSED",
}
