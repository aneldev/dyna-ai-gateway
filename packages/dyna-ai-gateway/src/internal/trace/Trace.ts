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

/**
 * Trace -- the audit log of every model call
 *
 * # About
 *
 * > The black-box recorder: what was sent, what came back, what it cost, what the checks said.
 *
 * One entry per model call, written by the `LLMClient` through `record` with the request, the result, the usage and the
 * list-price cost; the gateway adds through `annotate` what it knows after its checks: the KB chunk ids, the issues, the
 * prompt template and its version. Helper calls (memory, query rewrite, guardrail judge, embedding) are entries of their own
 * `ETraceKind`. `query` serves an audit or debugging page; `delete` and `anonymizeByUser` are the forgetting side (D54, D119).
 * Tenant-scoped: every method takes the tenant, nothing crosses it.
 *
 * Sits between the `LLMClient` and the orchestration, which write, and the host's `ITraceRepository`, which stores.
 *
 * # Who needs it
 *
 * The `LLMClient` after every call; the orchestration (`annotateTraces`, `deleteThreads`, `forgetUser`); the host, as
 * `gateway.trace`, for its audit pages. Constructed once from `IAIGatewayConfig.trace`; a host replaces it through
 * `IAIGatewayDeps.trace`.
 *
 * # What needs
 *
 * `ITraceConfig.repository`: the host's adapter.
 *
 * # Pitfalls
 *
 * The entry holds the request as sent and the raw result: system prompts, tool outputs, the user's text. A repository that
 * must not keep them drops `request` and `result` in `save`; `query` returns them raw, so the host checks who may read before
 * it calls.
 */
export class Trace implements ITrace {
  constructor(private readonly config: ITraceConfig) {}

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
