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
  /** Persistence; Mongo in v1. */
  repository: ITraceRepository;
}

/**
 * Audit log of every model interaction.
 *
 * Implemented by `Trace`; the type of `IAIGatewayDeps.trace`, so a host may pass its own in `overrides`.
 */
export interface ITrace {
  /**
   * Records one interaction. Called by the LLMClient. Never throws into the caller's path:
   * a failing repository is reported with console.error and the call goes on.
   */
  record(args: {entry: ITraceEntry}): Promise<void>;

  /**
   * Adds gateway-level facts to an existing entry: its chunk ids and issues grow by the given ones,
   * and the prompt template that built the request is noted when given. Throws for an unknown entry.
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

  /** Paged search for debugging and audits. */
  query(args: {
    tenantId: string;
    filters: ITraceFilters;
    skip: number;
    limit: number;
  }): Promise<ITraceEntry[]>;

  /** Hard-deletes the entries of threads: the listed ids or `"all"`, of one user when `userId` is given. Returns how many. */
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<number>;

  /** Keeps every entry of a user as an audit skeleton under the pseudonym (GDPR pseudonymisation): usage and cost stay, prompts and answers go. Returns how many. */
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<number>;
}

/** Persistence seam. */
export interface ITraceRepository {
  /** Inserts or replaces by id. */
  save(args: {entry: ITraceEntry}): Promise<void>;
  /** One entry by id; null when unknown. Trace.annotate needs it. */
  load(args: {
    tenantId: string;
    traceId: string;
  }): Promise<ITraceEntry | null>;
  query(args: {
    tenantId: string;
    filters: ITraceFilters;
    skip: number;
    limit: number;
  }): Promise<ITraceEntry[]>;
  /**
   * Hard-deletes the entries of the threads (`"all"`: every entry of the tenant, the ones without a thread included), narrowed
   * to one user when `userId` is given. Returns how many.
   */
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<number>;
  /**
   * Keeps the entries of a user as an audit skeleton (GDPR pseudonymisation): `userId` becomes the pseudonym, `request` and
   * `result` are removed; usage, cost, model, kind, chunk ids, issues and dates stay. Returns how many.
   */
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<number>;
}

/** One recorded LLM interaction. */
export interface ITraceEntry {
  id: string;
  tenantId: string;
  /** Absent for system jobs (e.g. KB ingestion). */
  userId?: string;
  /** The profile the call ran on. Absent for system jobs (e.g. KB ingestion). */
  profileId?: string;
  threadId?: string;
  runId?: string;
  kind: ETraceKind;
  modelId: string;
  templateKey?: EPromptTemplateKey;
  templateVersion?: number;
  /**
   * The request as sent, its files without their bytes (D108) and without the `outputSchema` (D36: a zod schema is code, it
   * cannot be stored). A repository that must not keep it drops it in `save`.
   */
  request?: Omit<IModelRequest, "outputSchema">;
  /** Absent for EMBED. */
  result?: IModelResult;
  usage: IUsage;
  /** Filled by Trace.annotate for CHAT / RUN_STEP. */
  chunkIds: string[];
  /** Filled by Trace.annotate for CHAT / RUN_STEP. */
  issues: IIssue[];
  /** List-price cost of the call (`ModelRegistry.estimateCostUsd`). */
  costUsd: number;
  createdAt: Date;
}

/** What kind of call was traced. */
export enum ETraceKind {
  CHAT = "CHAT",
  RUN_STEP = "RUN_STEP",
  MEMORY_WORKING = "MEMORY_WORKING",
  MEMORY_USER = "MEMORY_USER",
  QUERY_REWRITE = "QUERY_REWRITE",
  GUARDRAIL_JUDGE = "GUARDRAIL_JUDGE",
  EMBED = "EMBED",
}

/** Query filters for the admin UI. */
export interface ITraceFilters {
  userId?: string;
  threadId?: string;
  kind?: ETraceKind;
  /** Inclusive. */
  from?: Date;
  /** Inclusive. */
  to?: Date;
}
