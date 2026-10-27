import {dynaError} from "dyna-error";
import {randomUUID} from "node:crypto";

import {
  IHumanGate,
  IHumanGateConfig,
  IHumanGateDeps,
  TPauseEnvelope,
  TPauseEnvelopeDraft,
  IResumeDecision,
  EPauseKind,
  EResumeAction,
} from "./types";

import {
  IRun,
  ERunStatus,
} from "../run-store";

import {validateAnswers} from "./utils/validateAnswers";

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

/** Pause and resume mechanics for runs. */
export class HumanGate implements IHumanGate {
  constructor(
    private readonly config: IHumanGateConfig,
    private readonly deps: IHumanGateDeps,
  ) {}

  /**
   * Persists the run as PAUSED with its envelopes (runId, a fresh pauseId and one expiresAt added to each) and returns them for the UI.
   * One envelope per tool call of the step that waits for a human (D102), or the one envelope of a result review (D99).
   */
  public async pause(
    {
      tenantId,
      run,
      envelopes,
    }: {
      tenantId: string;
      run: IRun;
      envelopes: TPauseEnvelopeDraft[];
    },
  ): Promise<TPauseEnvelope[]> {
    if (envelopes.length === 0) {
      throw dynaError({
        code: 5376634521017,
        status: 500,
        message: `HumanGate: run [${run.id}] cannot pause without an envelope`,
        data: {runId: run.id},
      });
    }
    const expiresAt = new Date(Date.now() + (this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    const pauseId = randomUUID();
    const pending: TPauseEnvelope[] = envelopes.map((envelope): TPauseEnvelope => ({
      ...envelope,
      runId: run.id,
      pauseId,
      expiresAt,
    }));
    await this.deps.runStore.save({
      run: {
        ...run,
        tenantId,
        status: ERunStatus.PAUSED,
        pending,
        updatedAt: new Date(),
      },
    });
    return pending;
  }

  /**
   * resume -- lets the decisions through and marks the run RUNNING
   *
   * # About
   *
   * > One pause, one answer: a decision per envelope, and the first caller wins, every other one is refused.
   *
   * Validates the decisions (`assertResumable`), then moves the run PAUSED to RUNNING in one atomic step (D69) and returns it.
   * The LLMClient applies the decisions (`run.resume`).
   *
   * - 409 when the run is not paused, when `pauseId` is not the pause the run waits on, or another caller resumed or cancelled it first.
   * - 410 when the pause has expired.
   * - 400 when a decision names no envelope, an envelope gets no decision or two, or an action is not allowed on its envelope.
   *
   * # Who needs it
   *
   * `AIGateway.resume`, after the profile, tool and answer checks, before the LLMClient continues the run.
   *
   * # Pitfalls
   *
   * Two resumes at once (a double click, two tabs) reach this method together; the atomic transition admits one,
   * so a side-effect tool never runs twice for one approval.
   */
  public async resume(
    {
      tenantId,
      runId,
      pauseId,
      decisions,
    }: {
      tenantId: string;
      runId: string;
      /** The pause the decisions are for (`envelope.pauseId`). */
      pauseId: string;
      decisions: IResumeDecision[];
    },
  ): Promise<IRun> {
    const run = await this.deps.runStore.load({
      tenantId,
      runId,
    });
    this.assertResumable({
      run,
      pauseId,
      decisions,
    });

    const resumed = await this.deps.runStore.transition({
      tenantId,
      runId,
      from: ERunStatus.PAUSED,
      to: ERunStatus.RUNNING,
    });
    if (!resumed) {
      throw dynaError({
        code: 5375172583923,
        status: 409,
        message: `HumanGate: run [${runId}] was resumed or cancelled by another call`,
        data: {runId},
      });
    }
    return resumed;
  }

  /**
   * assertResumable -- the checks of `resume` on a run already loaded, without I/O
   *
   * # About
   *
   * > Refuse early what `resume` would refuse anyway.
   *
   * Throws what `resume` throws for a run that cannot take these decisions: 409 when the run is not paused or `pauseId` names
   * another pause of it, 410 when the pause
   * has expired, 400 when the decisions do not answer the pause — every envelope needs exactly one decision, named by the
   * envelope's `callId` (a single-envelope pause takes one decision without it), with an action among that envelope's `allowed`.
   * Returns nothing when the decisions may go through; `matchDecisions` gives the pairs.
   *
   * `AIGateway.resume` calls it first, so a resume that is doomed pays no judge call for the answer screen (D71) and no
   * repository reads; `resume` calls it again on the run it reloads, right before the atomic transition.
   *
   * # Pitfalls
   *
   * It does not reserve anything: another caller can still win the transition in `resume`.
   */
  public assertResumable(
    {
      run,
      pauseId,
      decisions,
    }: {
      run: IRun;
      pauseId: string;
      decisions: IResumeDecision[];
    },
  ): void {
    this.matchDecisions({
      run,
      pauseId,
      decisions,
    });
  }

  /**
   * matchDecisions -- pairs every decision of a resume with the envelope it answers
   *
   * # About
   *
   * > Which card does this answer belong to.
   *
   * The pairs in the order of the envelopes. Throws what `assertResumable` throws: 409 when the run is not paused or `pauseId`
   * is not the pause it waits on (a decision meant for an earlier pause of the same run), 410 when
   * the pause has expired, 400 when a decision names no envelope of the pause (`callId`), an envelope gets no decision or
   * two, or an action is not among its envelope's `allowed`. A pause of one envelope takes a single decision without `callId`.
   *
   * # Who needs it
   *
   * `assertResumable`, and `AIGateway.resume` to read each decision next to its envelope (the answer screen, the rejection texts).
   */
  public matchDecisions(
    {
      run,
      pauseId,
      decisions,
    }: {
      run: IRun;
      /** The pause the decisions are for (`envelope.pauseId`). */
      pauseId: string;
      decisions: IResumeDecision[];
    },
  ): Array<{envelope: TPauseEnvelope; decision: IResumeDecision}> {
    const pending = this.getPendingOf(run);
    if (!pending) {
      throw dynaError({
        code: 5372577355257,
        status: 409,
        message: `HumanGate: run [${run.id}] is not waiting for a human (status [${run.status}])`,
        data: {
          runId: run.id,
          status: run.status,
        },
      });
    }
    // A run pauses again under the same id (a tool, then its answer's review): a decision names the pause it was made for
    if (pending[0]?.pauseId !== pauseId) {
      throw dynaError({
        code: 5377210486197,
        status: 409,
        message: `HumanGate: the decisions are for pause [${pauseId}] of run [${run.id}], which waits on another pause`,
        userMessage: "This decision was made for an earlier step; please reload and decide again",
        data: {
          runId: run.id,
          pauseId,
        },
      });
    }
    const expiresAt = pending[0]?.expiresAt;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw dynaError({
        code: 5372577355269,
        status: 410,
        message: `HumanGate: the pause of run [${run.id}] has expired`,
        data: {
          runId: run.id,
          expiresAt,
        },
      });
    }

    const byCallId = new Map<string, TPauseEnvelope>(
      pending.flatMap((envelope): Array<[string, TPauseEnvelope]> => "callId" in envelope ? [[envelope.callId, envelope]] : []),
    );
    const matched = new Map<TPauseEnvelope, IResumeDecision>();
    for (const decision of decisions) {
      const envelope =
        decision.callId === undefined
          ? (pending.length === 1 && decisions.length === 1 ? pending[0] : undefined)
          : byCallId.get(decision.callId);
      if (!envelope) {
        throw dynaError({
          code: 5376634521029,
          status: 400,
          message: decision.callId === undefined
            ? `HumanGate: a decision for run [${run.id}] needs a callId, the pause carries ${pending.length} envelopes`
            : `HumanGate: the decision names no envelope of run [${run.id}]: callId [${decision.callId}]`,
          data: {
            runId: run.id,
            callId: decision.callId,
            callIds: [...byCallId.keys()],
          },
        });
      }
      if (matched.has(envelope)) {
        throw dynaError({
          code: 5376634521031,
          status: 400,
          message: `HumanGate: two decisions for one envelope of run [${run.id}]: callId [${decision.callId}]`,
          data: {
            runId: run.id,
            callId: decision.callId,
          },
        });
      }
      if (!envelope.allowed.includes(decision.action)) {
        throw dynaError({
          code: 5372577355281,
          status: 400,
          message: `HumanGate: action [${decision.action}] is not allowed for run [${run.id}]${decision.callId === undefined ? "" : ` on callId [${decision.callId}]`}`,
          data: {
            runId: run.id,
            callId: decision.callId,
            action: decision.action,
            allowed: envelope.allowed,
          },
        });
      }
      // The answers the card allows, with the card's question texts: what the screen, the model and the turns get
      matched.set(envelope, envelope.kind === EPauseKind.USER_QUESTION && decision.action === EResumeAction.ANSWER
        ? {
          ...decision,
          answers: validateAnswers({
            runId: run.id,
            callId: envelope.callId,
            userQuestions: envelope.userQuestions,
            answers: decision.answers,
          }),
        }
        : decision);
    }
    const unanswered = pending.filter(envelope => !matched.has(envelope));
    if (unanswered.length > 0) {
      throw dynaError({
        code: 5376634521043,
        status: 400,
        message: `HumanGate: every envelope of run [${run.id}] needs a decision; ${unanswered.length} of ${pending.length} got none`,
        data: {
          runId: run.id,
          unanswered: unanswered.flatMap(envelope => "callId" in envelope ? [envelope.callId] : []),
        },
      });
    }
    return pending.flatMap(envelope => {
      const decision = matched.get(envelope);
      return decision
        ? [{
          envelope,
          decision,
        }]
        : [];
    });
  }

  /** The current envelopes of a paused run, for reloading the UI; null when the run is not paused. */
  public async getPending(
    {
      tenantId,
      runId,
    }: {
      tenantId: string;
      runId: string;
    },
  ): Promise<TPauseEnvelope[] | null> {
    return this.getPendingOf(await this.deps.runStore.load({
      tenantId,
      runId,
    }));
  }

  /** Paused runs of a tenant (optionally one user), for the inbox UI. */
  public async listPaused(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId?: string;
    },
  ): Promise<IRun[]> {
    return this.deps.runStore.listPaused({
      tenantId,
      userId,
    });
  }

  /**
   * cancel -- closes a paused run the user gave up on
   *
   * # About
   *
   * > PAUSED to CANCELLED, atomically; a run that is not paused is a 409.
   *
   * # Who needs it
   *
   * `AIGateway.cancelRun`, before `closeRun` rejects the pending tool calls.
   */
  public async cancel(
    {
      tenantId,
      runId,
    }: {
      tenantId: string;
      runId: string;
    },
  ): Promise<void> {
    const cancelled = await this.deps.runStore.transition({
      tenantId,
      runId,
      from: ERunStatus.PAUSED,
      to: ERunStatus.CANCELLED,
    });
    if (!cancelled) {
      const run = await this.deps.runStore.load({
        tenantId,
        runId,
      });
      throw dynaError({
        code: 5372577355293,
        status: 409,
        message: `HumanGate: run [${runId}] cannot be cancelled, it is not paused (status [${run.status}])`,
        data: {
          runId,
          status: run.status,
        },
      });
    }
  }

  /**
   * expirePaused -- cancels the pauses nobody answered in time
   *
   * # About
   *
   * > Every paused run of the tenant whose `expiresAt` has passed becomes CANCELLED; the cancelled runs come back, with the
   * > envelopes of their pause.
   *
   * A PAUSED run without an envelope counts as due too (D80): nothing can resume it (`assertResumable` is a 409 without a
   * pending envelope), so it would hold its thread for ever; the job is the only way out of that state. The envelopes of one
   * pause share their `expiresAt`, so the first one speaks for all.
   * Each run leaves PAUSED through the atomic transition (D69), so a resume racing with the job loses cleanly.
   * The gate only moves the runs: closing their tool calls in the thread and reopening the thread is the gateway's
   * part (`AIGateway.expirePausedRuns`), which needs the runs, hence the return value (D75). The transition clears `pending`,
   * so each returned run carries the envelopes of its pause again: the gateway closes every call with its own rejection text (D87).
   *
   * # Who needs it
   *
   * `AIGateway.expirePausedRuns`, called by a scheduled job of the application.
   */
  public async expirePaused({tenantId}: {tenantId: string}): Promise<IRun[]> {
    const now = Date.now();
    const paused = await this.deps.runStore.listPaused({tenantId});
    const due = paused.filter(run => {
      const expiresAt = this.getPendingOf(run)?.[0]?.expiresAt;
      return expiresAt === undefined || expiresAt.getTime() <= now;
    });
    const expired: IRun[] = [];
    for (const run of due) {
      const cancelled = await this.deps.runStore.transition({
        tenantId,
        runId: run.id,
        from: ERunStatus.PAUSED,
        to: ERunStatus.CANCELLED,
      });
      if (cancelled) {
        expired.push({
          ...cancelled,
          pending: run.pending,
        });
      }
    }
    return expired;
  }

  /** The envelopes of a paused run; null when the run is not paused or carries none (D80). */
  private getPendingOf(run: IRun): TPauseEnvelope[] | null {
    return run.status === ERunStatus.PAUSED && run.pending && run.pending.length > 0 ? run.pending : null;
  }
}
