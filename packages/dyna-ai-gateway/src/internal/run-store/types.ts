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
  /** Persistence of the runs: the host's adapter; `InMemoryRunRepository` ships with the gateway. */
  repository: IRunRepository;
}

/**
 * Tenant-scoped persistence of runs.
 *
 * Implemented by `RunStore`; the type of `IAIGatewayDeps.runStore`, so a host may pass its own in `overrides`.
 */
export interface IRunStore {
  /**
   * save -- creates or replaces a run
   *
   * # About
   *
   * > The whole run, as it is now.
   *
   * Passes the run to the repository, which replaces it by `id`.
   *
   * # Who needs it
   *
   * `HumanGate.pause` (the first write of a run that pauses), the settlement of a review (`settleReview`), and the resume
   * path when the run switches profile (D65).
   */
  save(args: {run: IRun}): Promise<void>;

  /**
   * load -- one run of the tenant
   *
   * # About
   *
   * > The run, or a 404.
   *
   * Throws a 404 (error 5372577355245) when the run is missing or belongs to another tenant; the repository's null never
   * reaches a caller.
   *
   * # Who needs it
   *
   * `HumanGate.resume` and `cancel`; `AIGateway.getPausedRun`, `cancelRun` and the resume path; `closeRun`.
   */
  load(args: {
    tenantId: string;
    runId: string;
  }): Promise<IRun>;

  /**
   * listPaused -- the runs waiting for a human
   *
   * # About
   *
   * > The inbox.
   *
   * The tenant's PAUSED runs, narrowed to one user when `userId` is given.
   *
   * # Who needs it
   *
   * `HumanGate.listPaused` and `expirePaused`; `AIProfileStore.removeProfile`, which refuses while a paused run uses the
   * profile.
   */
  listPaused(args: {
    tenantId: string;
    userId?: string;
  }): Promise<IRun[]>;

  /**
   * listRunning -- the runs marked RUNNING
   *
   * # About
   *
   * > A live call's run, or one an instance that died left behind.
   *
   * The tenant's RUNNING runs. A RUNNING run whose thread has no live lease is stuck (D97).
   *
   * # Who needs it
   *
   * `AIGateway.recoverStuckRuns`, from a scheduled job of the application.
   */
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

  /**
   * setStatus -- changes the status of a run
   *
   * # About
   *
   * > For the status changes nobody races for.
   *
   * Loads the run (a 404 when missing) and saves it with the new status and `updatedAt` now; nothing else changes.
   *
   * # Who needs it
   *
   * `settleRun` (DONE, FAILED after a resumed run finished), `closeRun`, `AIGateway.closeFailedRun`.
   *
   * # Pitfalls
   *
   * Read-then-save: a concurrent writer can be overwritten. PAUSED to anything is `transition`'s job.
   */
  setStatus(args: {
    tenantId: string;
    runId: string;
    status: ERunStatus;
  }): Promise<void>;

  /**
   * delete -- hard-deletes the runs of threads
   *
   * # About
   *
   * > The threads go, their runs go with them (D119).
   *
   * Removes the runs of the listed thread ids, or of every thread of the tenant with `"all"`, narrowed to one user when
   * `userId` is given. Returns how many.
   *
   * # Who needs it
   *
   * `deleteThreads` (behind `AIGateway.deleteThreads`) and `forgetUser` (behind `AIGateway.deleteUserData`, D54).
   */
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<number>;

  /**
   * anonymizeByUser -- keeps a user's runs as skeletons under a pseudonym
   *
   * # About
   *
   * > The record that a run happened stays; what the user said in it goes.
   *
   * The repository replaces `userId` with the pseudonym and empties `messages`, `request.system`, `skills`, `pending` and
   * `answer`; id, status, steps and dates stay. An open run (RUNNING or PAUSED) becomes CANCELLED, since nobody can resume
   * it. Returns how many.
   *
   * # Who needs it
   *
   * `forgetUser`, behind `AIGateway.anonymizeUserData` (D54).
   */
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<number>;
}

/** Persistence seam of the runs: what a host implements over its database; the `RunStore` adds the 404 and the status helpers. */
export interface IRunRepository {
  /**
   * save -- creates or replaces the run
   *
   * # About
   *
   * > Whole, by `id` within the tenant.
   *
   * The run as the gateway holds it: request, messages, status, pending calls, answer.
   *
   * # Who needs it
   *
   * `RunStore.save` and `setStatus`.
   */
  save(args: {run: IRun}): Promise<void>;
  /**
   * load -- the run of a tenant by id
   *
   * # About
   *
   * > Null when missing or of another tenant.
   *
   * The run as stored, whole.
   *
   * # Who needs it
   *
   * `RunStore.load`.
   */
  load(args: {
    tenantId: string;
    runId: string;
  }): Promise<IRun | null>;
  /**
   * listByStatus -- the tenant's runs in one status
   *
   * # About
   *
   * > Narrowed to one user when `userId` is given; any order.
   *
   * Every run of the tenant whose `status` matches.
   *
   * # Who needs it
   *
   * `RunStore.listPaused` and `listRunning`.
   */
  listByStatus(args: {
    tenantId: string;
    status: ERunStatus;
    userId?: string;
  }): Promise<IRun[]>;
  /**
   * transition -- moves a run from one status to another atomically
   *
   * # About
   *
   * > Compare-and-set (D69): two callers racing for the same run, exactly one gets it.
   *
   * Returns the updated run, or null when the run is missing or not in `from`; `pending` is cleared when `to` is not PAUSED.
   * One database operation with the condition in the filter, never a load followed by a save.
   *
   * # Who needs it
   *
   * `RunStore.transition`, for every status change that must be taken once: a resume, a cancel, an expiry.
   */
  transition(args: {
    tenantId: string;
    runId: string;
    from: ERunStatus;
    to: ERunStatus;
  }): Promise<IRun | null>;
  /**
   * delete -- hard-deletes the runs of threads
   *
   * # About
   *
   * > The listed ids, or every run of the tenant for `"all"`.
   *
   * Narrowed to one user when `userId` is given. Returns how many went.
   *
   * # Who needs it
   *
   * `RunStore.delete`, for the gateway's `delete` and `deleteUserData`.
   */
  delete(args: {
    tenantId: string;
    threadIds: TThreadIds;
    userId?: string;
  }): Promise<number>;
  /**
   * anonymizeByUser -- keeps a user's runs as skeletons
   *
   * # About
   *
   * > GDPR pseudonymisation: the words go, the record stays.
   *
   * `userId` becomes the pseudonym; `messages`, `request.system`, `request.outputSchema`, `skills`, `pending` and `answer` are
   * emptied; a RUNNING or PAUSED run becomes CANCELLED; id, status, steps and dates stay. Returns how many.
   *
   * # Who needs it
   *
   * `RunStore.anonymizeByUser`, for the gateway's `anonymizeUserData`.
   */
  anonymizeByUser(args: {
    tenantId: string;
    userId: string;
    pseudonym: string;
  }): Promise<number>;
}

/** The persisted state of one agent run. */
export interface IRun {
  /** The run's id (`IPausedResponse.runId`); kept across the pauses of one run. */
  id: string;
  /** The owner; every read is filtered by it. */
  tenantId: string;
  /** The thread the run answers on; one thread has at most one open run. */
  threadId: string;
  /** The user who asked; the pseudonym after `anonymizeByUser`. */
  userId: string;
  /** The profile the run started on; a resume may switch it (D65), the run is saved with the new one. */
  profileId: string;
  /** Where the run is in its lifecycle (`ERunStatus`). */
  status: ERunStatus;
  /**
   * The request as built for step 1 (system, modelId, caps); messages live separately below. No `outputSchema`: a zod schema
   * is code, not data, so `resume` takes it again from its caller (D36).
   */
  request: Omit<IModelRequest, "messages" | "outputSchema">;
  /** Tool names resolved for this run; re-fetched from ToolRegistry on resume. `dyna_aigw_load_skill` among them is rebuilt from `skills`. */
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
  /** When the run was first stored. */
  createdAt: Date;
  /** When the run was last saved or changed status. */
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
  /** A call is executing it, or an instance died with it (`recoverStuckRuns`, D97). */
  RUNNING = "RUNNING",
  /** Waiting for a human: `pending` holds the envelopes. */
  PAUSED = "PAUSED",
  /** Answered. */
  DONE = "DONE",
  /** Ended without an answer: a failed step, a rejected review, an abort, a stuck run recovered. */
  FAILED = "FAILED",
  /** Closed by `cancelRun`, by an expired pause or by the user's pseudonymisation. */
  CANCELLED = "CANCELLED",
}
