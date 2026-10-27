import {InMemoryRunRepository} from "../../../adapters/in-memory";

import {
  IRun,
  RunStore,
  ERunStatus,
} from "../../run-store";

import {HumanGate} from "../HumanGate";

/** A run stored as PAUSED with no `pending` (a partial write of another adapter): no decision can resume it, only the job can end it. */
const orphan: IRun = {
  id: "run-orphan",
  tenantId: "tenant-a",
  threadId: "thread-orphan",
  userId: "user-a",
  profileId: "profile-1",
  status: ERunStatus.PAUSED,
  request: {
    modelId: "model-a",
    system: "You are a test",
    maxOutputTokens: 500,
  },
  toolNames: ["refund"],
  startTurnCount: 0,
  chunkIds: [],
  templateVersion: 1,
  messages: [],
  steps: 1,
  createdAt: new Date(1_000),
  updatedAt: new Date(1_000),
};

/**
 * A PAUSED run without an envelope has no `expiresAt` to wait for and cannot be resumed; the expiry job cancels it at once
 * (D80), so its thread is reopened by the gateway instead of staying AWAITING_HUMAN for ever.
 */
test("expirePaused cancels a paused run that has no envelope", async () => {
  const repository = new InMemoryRunRepository();
  await repository.save({run: orphan});
  const gate = new HumanGate(
    {
      timeoutMs: 60_000,
      userQuestions: {enabled: false},
    },
    {runStore: new RunStore({repository})},
  );

  const expired = await gate.expirePaused({tenantId: "tenant-a"});

  expect(expired.map(run => [run.id, run.status])).toEqual([["run-orphan", ERunStatus.CANCELLED]]);
});
