import {EPartKind} from "../../../contracts";
import {EPauseKind} from "../../../internal/human-gate";
import {
  IRun,
  ERunStatus,
} from "../../../internal/run-store";

import {InMemoryRunRepository} from "../InMemoryRunRepository";

const pausedRun: IRun = {
  id: "run-1",
  tenantId: "tenant-a",
  threadId: "thread-1",
  userId: "user-a",
  profileId: "profile-1",
  status: ERunStatus.PAUSED,
  request: {
    modelId: "model-a",
    system: [{text: "You are a test"}],
    maxOutputTokens: 500,
  },
  toolNames: ["refund"],
  startTurnCount: 0,
  chunkIds: [],
  templateVersion: 1,
  messages: [],
  pending: [{
    kind: EPauseKind.TOOL_APPROVAL,
    runId: "run-1",
    pauseId: "pause-1",
    callId: "call-1",
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: "refund",
      input: {},
    },
    allowed: [],
    expiresAt: new Date(2_000),
  }],
  steps: 1,
  createdAt: new Date(1_000),
  updatedAt: new Date(1_000),
};

/** A run in `from` moves to `to`; leaving PAUSED clears the pending envelope; the move is stored and returned. */
test("transition moves a run that is in the expected status and clears its pending pause", async () => {
  const repository = new InMemoryRunRepository();
  await repository.save({run: pausedRun});

  const moved = await repository.transition({
    tenantId: "tenant-a",
    runId: "run-1",
    from: ERunStatus.PAUSED,
    to: ERunStatus.RUNNING,
  });

  const stored = await repository.load({
    tenantId: "tenant-a",
    runId: "run-1",
  });
  expect([moved?.status, moved?.pending, stored?.status, stored?.pending]).toEqual([
    ERunStatus.RUNNING,
    undefined,
    ERunStatus.RUNNING,
    undefined,
  ]);
});
