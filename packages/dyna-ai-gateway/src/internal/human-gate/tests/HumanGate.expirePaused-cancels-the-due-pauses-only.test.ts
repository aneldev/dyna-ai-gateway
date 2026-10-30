import {InMemoryRunRepository} from "../../../adapters/in-memory";
import {EPartKind} from "../../../contracts";

import {
  IRun,
  RunStore,
  ERunStatus,
} from "../../run-store";

import {HumanGate} from "../HumanGate";
import {
  TPauseEnvelopeDraft,
  EPauseKind,
  EResumeAction,
} from "../types";

const makeRun = (id: string): IRun => ({
  id,
  tenantId: "tenant-a",
  threadId: `thread-${id}`,
  userId: "user-a",
  profileId: "profile-1",
  status: ERunStatus.RUNNING,
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
  steps: 1,
  createdAt: new Date(1_000),
  updatedAt: new Date(1_000),
});

const envelope: TPauseEnvelopeDraft = {
  kind: EPauseKind.TOOL_APPROVAL,
  callId: "call-1",
  toolCall: {
    kind: EPartKind.TOOL_CALL,
    callId: "call-1",
    toolName: "refund",
    input: {amount: 500},
  },
  allowed: [EResumeAction.APPROVE, EResumeAction.REJECT],
};

/**
 * Two pauses of one tenant with a 60 s limit, one paused at t=10 s and one at t=50 s; at t=80 s only the first is due.
 * expirePaused cancels the due one and returns it; the other stays PAUSED; a second call finds nothing.
 */
test("expirePaused cancels and returns the pauses past their limit, leaves the others paused", async () => {
  jest.useFakeTimers();
  try {
    const runStore = new RunStore({repository: new InMemoryRunRepository()});
    const gate = new HumanGate(
      {
        timeoutMs: 60_000,
        userQuestions: {enabled: false},
      },
      {runStore},
    );
    jest.setSystemTime(10_000);
    await gate.pause({
      tenantId: "tenant-a",
      run: makeRun("run-old"),
      envelopes: [envelope],
    });
    jest.setSystemTime(50_000);
    await gate.pause({
      tenantId: "tenant-a",
      run: makeRun("run-new"),
      envelopes: [envelope],
    });
    jest.setSystemTime(80_000);

    const expired = await gate.expirePaused({tenantId: "tenant-a"});
    const expiredAgain = await gate.expirePaused({tenantId: "tenant-a"});

    const stillPaused = await runStore.listPaused({tenantId: "tenant-a"});
    const storedOld = await runStore.load({
      tenantId: "tenant-a",
      runId: "run-old",
    });
    expect([
      expired.map(run => [run.id, run.status, run.pending?.map(pending => "callId" in pending ? pending.callId : null)]),
      storedOld.pending,
      expiredAgain.length,
      stillPaused.map(run => run.id),
    ]).toEqual([
      [["run-old", ERunStatus.CANCELLED, ["call-1"]]],
      undefined,
      0,
      ["run-new"],
    ]);
  }
  finally {
    jest.useRealTimers();
  }
});
