import {
  IIssue,
  IUsage,
  TThreadIds,
} from "../../contracts";

import {EPromptTemplateKey} from "../prompt-template-store";
import {
  IModelRequest,
  IModelResult,
} from "../llm-client";

/** Configuration of the Trace. Lands in IAIGatewayConfig.trace. */
export interface ITraceConfig {
  /** Persistence: the host's adapter; `InMemoryTraceRepository` ships with the gateway for tests and the sandbox. */
  repository: ITraceRepository;
}

/**
 * Audit log of every model interaction.
 *
 * Implemented by `Trace`; the type of `IAIGatewayDeps.trace`, so a host may pass its own in `overrides`.
 */
export interface ITrace {
  /**
   * record -- writes the entry of one model call
   *
   * # About
   *
   * > The call already happened; a lost entry is logged, never thrown.
   *
   * Saves the entry the `LLMClient` built (`save` inserts or replaces by id). When the repository throws, the error is
   * logged and the call goes on: the answer belongs to the user, the audit gap to the server log.
   *
   * # Who needs it
   *
   * `LLMClient.account`, after every `complete` and `embed`, also for a failed or aborted call.
   */
  record(args: {entry: ITraceEntry}): Promise<void>;

  /**
   * annotate -- adds what the gateway knows to an entry
   *
   * # About
   *
   * > The LLMClient recorded the call; the checks that came after are written here.
   *
   * Loads the entry, merges the chunk ids (a set, no duplicates), appends the issues and notes the template key and version
   * when given, then saves it. Throws `5372588039586` / 404 for an entry the tenant does not have.
   *
   * # Who needs it
   *
   * `annotateTraces` of the orchestration, after the output check of an `ask` or a run and for the judge entries of every
   * check (D73).
   */
  annotate(args: {
    tenantId: string;
    traceId: string;
    chunkIds: string[];
    issues: IIssue[];
    /** The template the request was rendered from, and its version. */
    templateKey?: EPromptTemplateKey;
    templateVersion?: number;
  }): Promise<void>;

  /**
   * query -- the entries of a tenant, filtered and paged
   *
   * # About
   *
   * > "Why did it say that, what did it cost": the audit page's read.
   *
   * Passes the filters (`ITraceFilters`: user, thread, kind, dates) and the page (`skip`, `limit`) to the repository and returns
   * the entries as stored, request and result included.
   *
   * # Who needs it
   *
   * The host, as `gateway.trace.query`, for its audit and debugging pages; the tests, to read what a call did.
   */
  query(args: {
    tenantId: string;
    filters: ITraceFilters;
    skip: number;
    limit: number;
  }): Promise<ITraceEntry[]>;

  /**
   * delete -- removes the entries of threads
   *
   * # About
   *
   * > Hard delete: the audit of a deleted thread goes with it.
   *
   * The listed thread ids, or `"all"` for every entry of the tenant, the ones without a thread included; narrowed to one user
   * when `userId` is given (D119). Returns how many entries went.
   *
   * # Who needs it
   *
   * `deleteThreads` of the gateway's `delete`; `forgetUser` for `AIGateway.deleteUserData` (D54).
   */
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<number>;

  /**
   * anonymizeByUser -- keeps a user's entries as an audit skeleton
   *
   * # About
   *
   * > The numbers stay, the words go.
   *
   * GDPR pseudonymisation (D54): `userId` becomes the pseudonym, `request` and `result` are removed; usage, cost, model, kind,
   * chunk ids, issues and dates stay. Returns how many entries were changed.
   *
   * # Who needs it
   *
   * `forgetUser` for `AIGateway.anonymizeUserData`.
   */
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<number>;
}

/** Persistence seam. */
export interface ITraceRepository {
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
  save(args: {entry: ITraceEntry}): Promise<void>;
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
  load(args: {
    tenantId: string;
    traceId: string;
  }): Promise<ITraceEntry | null>;
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
  query(args: {
    tenantId: string;
    filters: ITraceFilters;
    skip: number;
    limit: number;
  }): Promise<ITraceEntry[]>;
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
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<number>;
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
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<number>;
}

/** One recorded LLM interaction. */
export interface ITraceEntry {
  /** The trace id: the `traceId` of the result, the usage report and the `rule_error` reports. */
  id: string;
  /** The tenant of the call; every query and deletion is scoped by it. */
  tenantId: string;
  /** Absent for system jobs (e.g. KB ingestion). */
  userId?: string;
  /** The profile the call ran on. Absent for system jobs (e.g. KB ingestion). */
  profileId?: string;
  /** The thread of the call; absent for a call outside a thread (an embedding, a KB ingestion). */
  threadId?: string;
  /** The run the call was a step of; absent outside a run. */
  runId?: string;
  /** What the call was for. */
  kind: ETraceKind;
  /** The model that answered. */
  modelId: string;
  /** The prompt template the request was rendered from; set by `annotate` for CHAT / RUN_STEP. */
  templateKey?: EPromptTemplateKey;
  /** The version of that template, so an answer can be read against the prompt of its day. */
  templateVersion?: number;
  /**
   * The request as sent, its files without their bytes (D108) and without the `outputSchema` (D36: a zod schema is code, it
   * cannot be stored). A repository that must not keep it drops it in `save`.
   */
  request?: Omit<IModelRequest, "outputSchema">;
  /** Absent for EMBED. */
  result?: IModelResult;
  /** What the provider reported; all zero for a failed or aborted call. */
  usage: IUsage;
  /** Filled by Trace.annotate for CHAT / RUN_STEP. */
  chunkIds: string[];
  /** Filled by Trace.annotate for CHAT / RUN_STEP. */
  issues: IIssue[];
  /** List-price cost of the call (`ModelRegistry.estimateCostUsd`). */
  costUsd: number;
  /** When the call ended. */
  createdAt: Date;
}

/** What kind of call was traced. */
export enum ETraceKind {
  /** The answer of an `ask`. */
  CHAT = "CHAT",
  /** One step of a `run` or a `resume`. */
  RUN_STEP = "RUN_STEP",
  /** A working-memory update of a thread (`WorkingMemory.saveContext`). */
  MEMORY_WORKING = "MEMORY_WORKING",
  /** A user-memory extraction (`UserMemoryStore.extract`). */
  MEMORY_USER = "MEMORY_USER",
  /** The rewrite of a follow-up question for the KB search (`QueryRewriter`). */
  QUERY_REWRITE = "QUERY_REWRITE",
  /** A judge call of a guardrail rule. */
  GUARDRAIL_JUDGE = "GUARDRAIL_JUDGE",
  /** An embedding call: the KB search's query or a KB ingestion; no `result`. */
  EMBED = "EMBED",
}

/** Query filters for the admin UI. */
export interface ITraceFilters {
  /** Only the entries of this user. */
  userId?: string;
  /** Only the entries of this thread. */
  threadId?: string;
  /** Only the entries of this kind. */
  kind?: ETraceKind;
  /** Inclusive. */
  from?: Date;
  /** Inclusive. */
  to?: Date;
}
