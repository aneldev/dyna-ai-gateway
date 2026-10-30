import {
  IIssue,
  ISkill,
  TThreadIds,
} from "../../contracts";

import {TPauseEnvelope} from "../human-gate";
import {
  IMessage,
  IModelRequest,
  IModelResult,
} from "../llm-client";

/** Configuration of the RunStore. Lands in IAIGatewayConfig.runStore. */
export interface IRunStoreConfig {
  /** Persistence; Mongo in v1. */
  repository: IRunRepository;
}

/**
 * Tenant-scoped persistence of runs.
 *
 * Implemented by `RunStore`; the type of `IAIGatewayDeps.runStore`, so a host may pass its own in `overrides`.
 */
export interface IRunStore {
  /** Creates or replaces a run. */
  save(args: {run: IRun}): Promise<void>;

  /** Loads a run; throws if missing or not owned by the tenant. */
  load(args: {
    tenantId: string;
    runId: string;
  }): Promise<IRun>;

  /** Runs waiting for a human, for the UI inbox. */
  listPaused(args: {
    tenantId: string;
    userId?: string;
  }): Promise<IRun[]>;

  /** Runs marked RUNNING: a live call's, or one an instance that died left behind (`recoverStuckRuns`, D97). */
  listRunning(args: {tenantId: string}): Promise<IRun[]>;

  /**
   * transition -- moves a run from one status to another, atomically
   *
   * # About
   *
   * > Compare-and-set on the status: the run moves only if it is still in `from`.
   *
   * Returns the moved run, or null when the run is missing or already left `from`. Of several callers racing for the
   * same run, exactly one gets it (D69); the others read null and must refuse.
   *
   * # Who needs it
   *
   * `HumanGate.resume` (PAUSED to RUNNING) and `HumanGate.cancel` (PAUSED to CANCELLED).
   *
   * # Usage
   *
   * ## When shouldn't use it
   *
   * A status change that nobody can race for: `setStatus`.
   */
  transition(args: {
    tenantId: string;
    runId: string;
    from: ERunStatus;
    to: ERunStatus;
  }): Promise<IRun | null>;

  /** Changes status only (and updatedAt). */
  setStatus(args: {
    tenantId: string;
    runId: string;
    status: ERunStatus;
  }): Promise<void>;

  /** Hard-deletes the runs of threads: the listed ids or `"all"`, of one user when `userId` is given. Returns how many. */
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<number>;

  /**
   * Keeps every run of a user as a skeleton under the pseudonym (GDPR pseudonymisation): no messages, no system prompt, no pending
   * pause; an open run is CANCELLED, since nobody can resume it. Returns how many.
   */
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<number>;
}

/** Persistence seam. */
export interface IRunRepository {
  save(args: {run: IRun}): Promise<void>;
  load(args: {
    tenantId: string;
    runId: string;
  }): Promise<IRun | null>;
  listByStatus(args: {
    tenantId: string;
    status: ERunStatus;
    userId?: string;
  }): Promise<IRun[]>;
  /**
   * Moves a run from one status to another in one atomic step (compare-and-set, D69).
   * Returns the updated run, or null when the run is missing or not in `from`; `pending` is cleared when `to` is not PAUSED.
   * Two callers racing for the same run: exactly one gets the run.
   */
  transition(args: {
    tenantId: string;
    runId: string;
    from: ERunStatus;
    to: ERunStatus;
  }): Promise<IRun | null>;
  /** Hard-deletes the runs of the threads (`"all"`: every run of the tenant), narrowed to one user when `userId` is given. Returns how many. */
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<number>;
  /**
   * Keeps the runs of a user as skeletons (GDPR pseudonymisation): `userId` becomes the pseudonym; `messages`, `request.system`,
   * `request.outputSchema`, `skills`, `pending` and `answer` are emptied; a RUNNING or PAUSED run becomes CANCELLED; id, status, steps and dates stay.
   * Returns how many.
   */
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<number>;
}

/** The persisted state of one agent run. */
export interface IRun {
  id: string;
  tenantId: string;
  threadId: string;
  userId: string;
  profileId: string;
  status: ERunStatus;
  /**
   * The request as built for step 1 (system, modelId, caps); messages live separately below. No `outputSchema`: a zod schema
   * is code, not data, so `resume` takes it again from its caller (D36).
   */
  request: Omit<IModelRequest, "messages" | "outputSchema">;
  /** Tool names resolved for this run; re-fetched from ToolRegistry on resume. `load_skill` among them is rebuilt from `skills`. */
  toolNames: string[];
  /**
   * The skills the call brought (`IGatewayRunInput.skills`, D124), present when it brought any.
   *
   * > A skill is data, so the run keeps it: a resume offers it again, next to the skills of the profile it resumes on.
   *
   * The profile's skills are not stored: they are read from the profile of the resume, as its tools are (D65). Emptied by
   * `anonymizeByUser`.
   */
  skills?: ISkill[];
  /**
   * The thread's turn count before the run's question was stored (D36).
   *
   * > The memory of a resumed run is extracted from the whole run, not from the resumed part.
   */
  startTurnCount: number;
  /** The knowledge-base chunks in the request (D36): the citations and the trace annotation of the resumed answer. */
  chunkIds: string[];
  /** The version of CHAT_MAIN the request was rendered from (D36): the trace annotation of the resumed steps. */
  templateVersion: number;
  /** LLMClient messages so far, including pending tool calls; their files without bytes, loaded again on resume (D108). */
  messages: IMessage[];
  /**
   * The envelopes of the pause, present while status is PAUSED: one per tool call of the step that waits for a human (D102),
   * or the one RESULT_REVIEW envelope (D99). Never empty while paused.
   */
  pending?: TPauseEnvelope[];
  /**
   * The checked answer of a run paused for review (D99); present while the pause is a RESULT_REVIEW.
   *
   * > What the settlement had in hand when the run paused, so the decision can finish it as a run that never paused.
   *
   * Cleared when the run leaves the review. The reviewer's copy is the envelope's `result`.
   */
  answer?: IStoredAnswer;
  /** Model calls done so far; the profile's `maxStepsPerRun` caps it. */
  steps: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The answer of a run as it passed the output checks, kept on the run while a human reviews it (D99).
 *
 * Stored by the gateway's settlement on a RESULT_REVIEW pause and read back on the decision: the model's result (text, usage,
 * trace id), the parsed `structured`, the citations, the warnings and the tool that ended the run.
 */
export interface IStoredAnswer {
  /** The model's final step, as the LLMClient returned it; `usage` is the run's whole usage. */
  result: IModelResult;
  /** The parsed, schema-checked answer; present when the run had an `outputSchema`. */
  structured?: unknown;
  /** Chunk ids of the knowledge base in the request: the citations and the trace annotation. */
  chunkIds: string[];
  /** The warnings of the output rules. */
  issues: IIssue[];
  /** Name of the tool that ended the run (D86), when a tool did. */
  endedByTool?: string;
}

/** Lifecycle of a run. */
export enum ERunStatus {
  RUNNING = "RUNNING",
  PAUSED = "PAUSED",
  DONE = "DONE",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}
