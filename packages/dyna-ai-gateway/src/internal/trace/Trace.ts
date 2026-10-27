import {dynaError} from "dyna-error";

import {
  IIssue,
  TThreadIds,
} from "../../contracts";

import {EPromptTemplateKey} from "../prompt-template-store";

import {
  ITrace,
  ITraceConfig,
  ITraceEntry,
  ITraceFilters,
} from "./types";

/** Audit log of every model interaction. */
export class Trace implements ITrace {
  constructor(private readonly config: ITraceConfig) {}

  /**
   * Records one interaction. Called by the LLMClient. Never throws into the caller's path:
   * a failing repository is reported with console.error and the call goes on.
   */
  public async record(
    {entry}: {entry: ITraceEntry},
  ): Promise<void> {
    try {
      await this.config.repository.save({entry});
    }
    catch (error) {
      console.error(`Trace: the entry [${entry.id}] could not be recorded`, error);
    }
  }

  /**
   * Adds gateway-level facts to an existing entry: its chunk ids and issues grow by the given ones,
   * and the prompt template that built the request is noted when given. Throws for an unknown entry.
   */
  public async annotate(
    {
      tenantId,
      traceId,
      chunkIds,
      issues,
      templateKey,
      templateVersion,
    }: {
      tenantId: string;
      traceId: string;
      chunkIds: string[];
      issues: IIssue[];
      /** The template the request was rendered from, and its version. */
      templateKey?: EPromptTemplateKey;
      templateVersion?: number;
    },
  ): Promise<void> {
    const entry = await this.config.repository.load({
      tenantId,
      traceId,
    });
    if (!entry) {
      throw dynaError({
        code: 5372588039586,
        status: 404,
        message: `Trace: unknown entry [${traceId}] for tenant [${tenantId}]`,
        data: {
          tenantId,
          traceId,
        },
      });
    }
    await this.config.repository.save({
      entry: {
        ...entry,
        chunkIds: [...new Set([...entry.chunkIds, ...chunkIds])],
        issues: [...entry.issues, ...issues],
        templateKey: templateKey ?? entry.templateKey,
        templateVersion: templateVersion ?? entry.templateVersion,
      },
    });
  }

  /** Paged search for debugging and audits. */
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
    return this.config.repository.query({
      tenantId,
      filters,
      skip,
      limit,
    });
  }

  /** Hard-deletes the entries of threads: the listed ids or `"all"`, of one user when `userId` is given. Returns how many. */
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
    return this.config.repository.delete({
      tenantId,
      threadIds,
      userId,
    });
  }

  /** Keeps every entry of a user as an audit skeleton under the pseudonym (GDPR pseudonymisation): usage and cost stay, prompts and answers go. Returns how many. */
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
    return this.config.repository.anonymizeByUser({
      tenantId,
      userId,
      pseudonym,
    });
  }
}
