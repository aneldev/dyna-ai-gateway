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
});

const envelope: TPauseEnvelopeDraft = {
  kind: EPauseKind.TOOL_APPROVAL,
  callId: "call-1",
  toolCall: {
    kind: EPartKind.TOOL_CALL,
    callId: "call-1",
    toolName: "refund",
    input: {invoiceId: "4521"},
  },
  allowed: [EResumeAction.APPROVE, EResumeAction.EDIT, EResumeAction.REJECT],
};

interface ISetup {
  gate: HumanGate;
  runStore: RunStore;
  pauseId: string;
}

/** A gate with run-1 paused at t = 10 000 (fake clock), timeout 60 s unless given. */
const setup = async (timeoutMs = 60_000): Promise<ISetup> => {
  jest.setSystemTime(10_000);
  const runStore = new RunStore({repository: new InMemoryRunRepository()});
  const gate = new HumanGate({
    timeoutMs,
    userQuestions: {enabled: false},
  }, {runStore});
  const [paused] = await gate.pause({
    tenantId: "tenant-a",
    run: makeRun("run-1"),
    envelopes: [envelope],
  });
  if (!paused) throw new Error("Test setup: the gate returned no envelope");
  return {
    gate,
    runStore,
    pauseId: paused.pauseId,
  };
};

const loadRun = (runStore: RunStore, runId = "run-1"): Promise<IRun> =>
  runStore.load({
    tenantId: "tenant-a",
    runId,
  });

const ids = {
  tenantId: "tenant-a",
  runId: "run-1",
};

describe("HumanGate", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("M2 — pause", () => {
    test("returns the envelope with the runId and expiresAt = now + timeoutMs", async () => {
      jest.setSystemTime(10_000);
      const gate = new HumanGate({
        timeoutMs: 60_000,
        userQuestions: {enabled: false},
      }, {runStore: new RunStore({repository: new InMemoryRunRepository()})});
      expect(await gate.pause({
        tenantId: "tenant-a",
        run: makeRun("run-1"),
        envelopes: [envelope],
      })).toEqual([{
        ...envelope,
        runId: "run-1",
        pauseId: expect.any(String),
        expiresAt: new Date(70_000),
      }]);
    });

    test("expiresAt defaults to 24 hours after now", async () => {
      jest.setSystemTime(0);
      const gate = new HumanGate({userQuestions: {enabled: false}}, {runStore: new RunStore({repository: new InMemoryRunRepository()})});
      const pending = await gate.pause({
        tenantId: "tenant-a",
        run: makeRun("run-1"),
        envelopes: [envelope],
      });
      expect(pending[0]?.expiresAt).toEqual(new Date(24 * 60 * 60 * 1_000));
    });

    test("stores the run as PAUSED", async () => {
      const {runStore} = await setup();
      expect((await loadRun(runStore)).status).toBe(ERunStatus.PAUSED);
    });

    test("getPending returns the envelope after pause", async () => {
      const {gate} = await setup();
      expect(await gate.getPending(ids)).toMatchObject([{
        runId: "run-1",
        kind: EPauseKind.TOOL_APPROVAL,
        toolCall: {toolName: "refund"},
      }]);
    });

    test("listPaused returns the paused run", async () => {
      const {gate} = await setup();
      expect((await gate.listPaused({tenantId: "tenant-a"})).map(run => run.id)).toEqual(["run-1"]);
    });
  });

  describe("M2 — resume", () => {
    test("marks the run RUNNING and returns it without the pending envelope", async () => {
      const {
        gate, pauseId,
      } = await setup();
      const run = await gate.resume({
        ...ids,
        pauseId,
        decisions: [{action: EResumeAction.APPROVE}],
      });
      expect([run.status, run.pending]).toEqual([ERunStatus.RUNNING, undefined]);
    });

    test("getPending is null after resume", async () => {
      const {
        gate, pauseId,
      } = await setup();
      await gate.resume({
        ...ids,
        pauseId,
        decisions: [{action: EResumeAction.REJECT}],
      });
      expect(await gate.getPending(ids)).toBeNull();
    });

    test("throws a 400 with code 5372577355281 for an action that is not allowed", async () => {
      const {
        gate, pauseId,
      } = await setup();
      await expect(gate.resume({
        ...ids,
        pauseId,
        decisions: [{action: EResumeAction.ANSWER}],
      })).rejects.toMatchObject({
        code: 5372577355281,
        status: 400,
        data: {
          runId: "run-1",
          action: EResumeAction.ANSWER,
        },
      });
    });

    test("a refused action leaves the run PAUSED", async () => {
      const {
        gate,
        runStore,
        pauseId,
      } = await setup();
      await gate.resume({
        ...ids,
        pauseId,
        decisions: [{action: EResumeAction.ANSWER}],
      }).catch(() => undefined);
      expect((await loadRun(runStore)).status).toBe(ERunStatus.PAUSED);
    });

    test("throws a 409 with code 5372577355257 when the run is not paused", async () => {
      const {
        gate, pauseId,
      } = await setup();
      await gate.resume({
        ...ids,
        pauseId,
        decisions: [{action: EResumeAction.APPROVE}],
      });
      await expect(gate.resume({
        ...ids,
        pauseId,
        decisions: [{action: EResumeAction.APPROVE}],
      })).rejects.toMatchObject({
        code: 5372577355257,
        status: 409,
      });
    });

    test("throws a 410 with code 5372577355269 when the pause has expired", async () => {
      const {
        gate, pauseId,
      } = await setup(60_000);
      jest.setSystemTime(70_000);
      await expect(gate.resume({
        ...ids,
        pauseId,
        decisions: [{action: EResumeAction.APPROVE}],
      })).rejects.toMatchObject({
        code: 5372577355269,
        status: 410,
      });
    });
  });

  describe("M2 — cancel", () => {
    test("cancel sets the run to CANCELLED", async () => {
      const {
        gate,
        runStore,
      } = await setup();
      await gate.cancel(ids);
      expect((await loadRun(runStore)).status).toBe(ERunStatus.CANCELLED);
    });

    test("getPending is null after cancel", async () => {
      const {gate} = await setup();
      await gate.cancel(ids);
      expect(await gate.getPending(ids)).toBeNull();
    });

    test("throws a 409 with code 5372577355293 when the run is not paused", async () => {
      const {gate} = await setup();
      await gate.cancel(ids);
      await expect(gate.cancel(ids)).rejects.toMatchObject({
        code: 5372577355293,
        status: 409,
      });
    });
  });
});
