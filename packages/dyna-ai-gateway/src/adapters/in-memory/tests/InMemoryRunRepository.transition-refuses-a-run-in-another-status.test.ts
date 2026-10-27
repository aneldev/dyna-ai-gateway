import {
  IRun,
  ERunStatus,
} from "../../../internal/run-store";

import {InMemoryRunRepository} from "../InMemoryRunRepository";

const runningRun: IRun = {
  id: "run-1",
  tenantId: "tenant-a",
  threadId: "thread-1",
  userId: "user-a",
  profileId: "profile-1",
  status: ERunStatus.RUNNING,
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

/** A run that is not in `from` (already moved, or missing) is left alone and null comes back: the compare-and-set lost. */
test("transition returns null and changes nothing for a run that is not in the expected status", async () => {
  const repository = new InMemoryRunRepository();
  await repository.save({run: runningRun});

  const moved = await repository.transition({
    tenantId: "tenant-a",
    runId: "run-1",
    from: ERunStatus.PAUSED,
    to: ERunStatus.RUNNING,
  });
  const missing = await repository.transition({
    tenantId: "tenant-a",
    runId: "run-2",
    from: ERunStatus.PAUSED,
    to: ERunStatus.RUNNING,
  });

  const stored = await repository.load({
    tenantId: "tenant-a",
    runId: "run-1",
  });
  expect([moved, missing, stored?.status, stored?.updatedAt]).toEqual([
    null,
    null,
    ERunStatus.RUNNING,
    new Date(1_000),
  ]);
});
