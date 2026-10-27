import {
  IIssue,
  IToolCallPart,
} from "../../contracts";

import {
  IRun,
  IRunStore,
} from "../run-store";

/** Configuration of the HumanGate. Lands in IAIGatewayConfig.humanGate. */
export interface IHumanGateConfig {
  /** A pause older than this is cancelled. Default 24h. */
  timeoutMs?: number;
  /** The built-in `ask_user_question` tool (D62): the model asks the user instead of guessing, and the run pauses with the questions. */
  userQuestions: {
    enabled: boolean;
  };
}

/** Shared instances HumanGate needs; created once by AIGateway and passed as the second constructor argument. */
export interface IHumanGateDeps {
  runStore: IRunStore;
}

/**
 * Pause and resume mechanics for runs.
 *
 * Implemented by `HumanGate`; the type of `IAIGatewayDeps.humanGate`, so a host may pass its own in `overrides`.
 */
export interface IHumanGate {
  /**
   * Persists the run as PAUSED with its envelopes (runId, a fresh pauseId and one expiresAt added to each) and returns them for the UI.
   * One envelope per tool call of the step that waits for a human (D102), or the one envelope of a result review (D99).
   */
  pause(args: {
    tenantId: string;
    run: IRun;
    envelopes: TPauseEnvelopeDraft[];
  }): Promise<TPauseEnvelope[]>;

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
  resume(args: {
    tenantId: string;
    runId: string;
    /** The pause the decisions are for (`envelope.pauseId`). */
    pauseId: string;
    decisions: IResumeDecision[];
  }): Promise<IRun>;

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
  assertResumable(args: {
    run: IRun;
    pauseId: string;
    decisions: IResumeDecision[];
  }): void;

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
  matchDecisions(args: {
    run: IRun;
    /** The pause the decisions are for (`envelope.pauseId`). */
    pauseId: string;
    decisions: IResumeDecision[];
  }): Array<{envelope: TPauseEnvelope; decision: IResumeDecision}>;

  /** The current envelopes of a paused run, for reloading the UI; null when the run is not paused. */
  getPending(args: {
    tenantId: string;
    runId: string;
  }): Promise<TPauseEnvelope[] | null>;

  /** Paused runs of a tenant (optionally one user), for the inbox UI. */
  listPaused(args: {
    tenantId: string;
    userId?: string;
  }): Promise<IRun[]>;

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
  cancel(args: {
    tenantId: string;
    runId: string;
  }): Promise<void>;

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
  expirePaused(args: {tenantId: string}): Promise<IRun[]>;
}

/** What every pause carries; HumanGate adds `runId`, `pauseId` and `expiresAt` (one of each for every envelope of a pause). */
interface IPauseEnvelopeBase {
  runId: string;
  /**
   * Names this pause of the run: `resume` must pass it, and a decision for an earlier pause of the same run is refused.
   *
   * > A run can pause again under the same `runId` (a tool, then its answer's review): the same request body must not decide both.
   */
  pauseId: string;
  /** Decisions the UI may offer. */
  allowed: EResumeAction[];
  /** After this the pause expires. */
  expiresAt: Date;
}

/**
 * What the UI receives when a run pauses; `kind` tells which fields are present. Data only, no text: the app renders the
 * card (and its language) from the tool name and input, as the AI SDK's approval parts and the OpenAI Agents SDK's interruptions do.
 */
export type TPauseEnvelope =
  | IToolApprovalEnvelope
  | IResultReviewEnvelope
  | IUserQuestionEnvelope;

/** A tool call awaits a human before it runs. */
export interface IToolApprovalEnvelope extends IPauseEnvelopeBase {
  kind: EPauseKind.TOOL_APPROVAL;
  /** The call this card is about, `toolCall.callId` repeated: the key a decision names (`IResumeDecision.callId`). */
  callId: string;
  toolCall: IToolCallPart;
  /**
   * What the model reads if the human rejects the call, from the tool's policy for this call (D87).
   *
   * > For the model, not for the card: the UI renders the pause from `toolCall`; this text is kept with the pause so a REJECT after
   * > a restart still sends it.
   *
   * Omitted = the default rejection text.
   */
  rejectionText?: string;
  /**
   * Why the call waits for a human, from the tool's policy for this call (`reasonCode` of its NEEDS_APPROVAL result).
   *
   * > For the card: a key of the app's translations, next to `toolCall.input`.
   *
   * Omitted when the policy gave none: the card says only what the call does.
   */
  reasonCode?: string;
}

/**
 * The final answer of a run awaits a human's review before the end user sees it (D99): the run finished and the answer passed
 * the output checks, and the profile (`IAIProfile.reviewAnswers`) asks a human to read it first. APPROVE delivers it, EDIT
 * delivers the reviewer's text instead, REJECT drops it; none of them calls the model.
 */
export interface IResultReviewEnvelope extends IPauseEnvelopeBase {
  kind: EPauseKind.RESULT_REVIEW;
  /**
   * The answer that waits for the reviewer.
   *
   * > The draft is for the reviewer only: what the asker gets (the PAUSED response, `listPausedRuns`) leaves it out.
   *
   * Present on the stored run (`AIGateway.getPausedRun`, the reviewer's read); absent where the asker can see the pause (D111).
   */
  result?: IReviewedAnswer;
}

/**
 * The answer as the reviewer sees it: what the end user would have received. Data only, the card renders it.
 *
 * Carried by `IResultReviewEnvelope`; built by the gateway from the checked answer of the run.
 */
export interface IReviewedAnswer {
  text: string;
  /** The parsed, schema-checked answer; present when the run had an `outputSchema`. */
  structured?: unknown;
  /** Chunk ids the answer was grounded on, as `IAnswerResponse.citations`. */
  citations: string[];
  /** The warnings of the output rules, as `IAnswerResponse.issues`; the reviewer sees what the UI would flag. */
  issues: IIssue[];
}

/** The model asks the user (D62): the questions are the input of its `ask_user_question` call, the answers come back with ANSWER. */
export interface IUserQuestionEnvelope extends IPauseEnvelopeBase {
  kind: EPauseKind.USER_QUESTION;
  /** The `ask_user_question` call this card is about: the key a decision names (`IResumeDecision.callId`). */
  callId: string;
  userQuestions: IUserQuestions;
}

/** What the model asks the user, as the UI renders it: a titled form of one or more questions. */
export interface IUserQuestions {
  title: string;
  description?: string;
  questions: IUserQuestion[];
}

/** One question of a user-question form; `mode` says how the UI renders it and what the answer carries. */
export interface IUserQuestion {
  text: string;
  /** One option (RADIO), several (CHECK) or a typed answer (FREE_TEXT). */
  mode: EUserQuestionMode;
  /** The answers to pick from; RADIO and CHECK only. */
  options?: string[];
  /** The user may type an own answer next to the options; RADIO and CHECK only. */
  freeOption?: boolean;
}

/** How a question is answered: by picking options or by typing (D85). */
export enum EUserQuestionMode {
  /** One of `options`. */
  RADIO = "RADIO",
  /** Several of `options`. */
  CHECK = "CHECK",
  /** Typed text, no options; the answer is `IUserAnswer.freeText`. */
  FREE_TEXT = "FREE_TEXT",
}

/**
 * The user's answer to one question, in the order of the questions. Checked against its card before anything else (D117):
 * `selected` only the question's options, `freeText` only where it takes typed text; a misfit is a 400.
 */
export interface IUserAnswer {
  /** The question's text, repeated so the model reads question and answer together; replaced by the card's own text (D117). */
  question: string;
  /** The picked options; empty for a free-text answer. */
  selected: string[];
  /** The typed answer (free-text question or `freeOption`). */
  freeText?: string;
}

/**
 * The envelopes of one pause, never empty: one per tool call of the step that waits for a human (D102), or the one
 * RESULT_REVIEW envelope (D99). A tuple type, so `envelopes[0]` is an envelope without a check.
 *
 * Carried by `IPausedResponse`; the stored run keeps the same list as `IRun.pending`.
 */
export type TPauseEnvelopes = [TPauseEnvelope, ...TPauseEnvelope[]];

/** The envelope as the gateway builds it, before HumanGate adds `runId`, `pauseId` and `expiresAt`. */
export type TPauseEnvelopeDraft = TPauseEnvelope extends infer E
  ? E extends TPauseEnvelope ? Omit<E, "runId" | "pauseId" | "expiresAt"> : never
  : never;

/** Why a run paused. */
export enum EPauseKind {
  TOOL_APPROVAL = "TOOL_APPROVAL",
  RESULT_REVIEW = "RESULT_REVIEW",
  USER_QUESTION = "USER_QUESTION",
}

/** What the human may do. */
export enum EResumeAction {
  /** Run the tool as asked (TOOL_APPROVAL), or deliver the answer as written (RESULT_REVIEW). */
  APPROVE = "APPROVE",
  /**
   * Approve with `editedInput`: the tool runs with the new input, or the answer is delivered with the reviewer's text. The
   * tool's policy decides again on the edited input (D109): DENY gives the denied result, NEEDS_APPROVAL counts as approved.
   */
  EDIT = "EDIT",
  /** The tool does not run and the model reads why (TOOL_APPROVAL); the answer is dropped and the call is FAILED (RESULT_REVIEW). */
  REJECT = "REJECT",
  /** Answer a user question (D62). */
  ANSWER = "ANSWER",
}

/** The human's decision. */
export interface IResumeDecision {
  action: EResumeAction;
  /**
   * The tool call this decision is for: the `callId` of its envelope.
   *
   * > One pause may carry several cards; the id says which one this answers.
   *
   * May be omitted when the pause carries one envelope; required when it carries several. Never set on a RESULT_REVIEW.
   *
   * @example "call_8f2a" - the id the approval envelope's `toolCall` carries
   */
  callId?: string;
  /**
   * What EDIT delivers instead: the new tool input on a TOOL_APPROVAL, the edited answer text (a string) on a RESULT_REVIEW.
   *
   * > The human corrects the model instead of refusing it.
   *
   * On a review with an `outputSchema`, the edited text is parsed through the schema again; a text the schema rejects is a 400 and the run stays paused.
   */
  editedInput?: unknown;
  /** The reason for REJECT: on a TOOL_APPROVAL the model reads it after the `rejectionText`; on a RESULT_REVIEW the FAILED response carries it. */
  text?: string;
  /** The answers for ANSWER, one per question of the user question (D62). */
  answers?: IUserAnswer[];
}
