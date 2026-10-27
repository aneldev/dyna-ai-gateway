import {InMemoryRunRepository} from "../../../../adapters/in-memory";
import {EPartKind} from "../../../../contracts";

import {
  IRun,
  RunStore,
  ERunStatus,
} from "../../../run-store";

import {HumanGate} from "../../HumanGate";
import {
  TPauseEnvelopeDraft,
  EPauseKind,
  EResumeAction,
  EUserQuestionMode,
} from "../../types";

export const ids = {
  tenantId: "tenant-a",
  runId: "run-1",
};

export const makeRun = (id = ids.runId): IRun => ({
  id,
  tenantId: ids.tenantId,
  threadId: "thread-1",
  userId: "user-a",
  profileId: "profile-1",
  status: ERunStatus.RUNNING,
  request: {
    modelId: "model-a",
    system: "You are a test",
    maxOutputTokens: 500,
  },
  toolNames: ["refund", "ask_user_question"],
  startTurnCount: 0,
  chunkIds: [],
  templateVersion: 1,
  messages: [],
  steps: 1,
  createdAt: new Date(1_000),
  updatedAt: new Date(1_000),
});

/** An approval card for a `refund` call with this id. */
export const approvalEnvelope = (callId: string): TPauseEnvelopeDraft => ({
  kind: EPauseKind.TOOL_APPROVAL,
  callId,
  toolCall: {
    kind: EPartKind.TOOL_CALL,
    callId,
    toolName: "refund",
    input: {amount: 500},
  },
  allowed: [EResumeAction.APPROVE, EResumeAction.EDIT, EResumeAction.REJECT],
});

/** A user-question card (D62) for an `ask_user_question` call with this id; ANSWER is its only action. */
export const questionEnvelope = (callId: string): TPauseEnvelopeDraft => ({
  kind: EPauseKind.USER_QUESTION,
  callId,
  userQuestions: {
    title: "Which order?",
    questions: [{
      text: "Order id",
      mode: EUserQuestionMode.FREE_TEXT,
    }],
  },
  allowed: [EResumeAction.ANSWER],
});

export interface IPausedGate {
  gate: HumanGate;
  runStore: RunStore;
  /** The pause the gate made; `resume` and `matchDecisions` take it. */
  pauseId: string;
}

/** A gate with run-1 paused on these envelopes (timeout 60 s, fake clock at t = 10 000). */
export const setupPaused = async (envelopes: TPauseEnvelopeDraft[]): Promise<IPausedGate> => {
  jest.setSystemTime(10_000);
  const runStore = new RunStore({repository: new InMemoryRunRepository()});
  const gate = new HumanGate(
    {
      timeoutMs: 60_000,
      userQuestions: {enabled: true},
    },
    {runStore},
  );
  const [paused] = await gate.pause({
    tenantId: ids.tenantId,
    run: makeRun(),
    envelopes,
  });
  if (!paused) throw new Error("Test setup: the gate returned no envelope");
  return {
    gate,
    runStore,
    pauseId: paused.pauseId,
  };
};
