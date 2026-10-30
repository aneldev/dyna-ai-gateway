import {EPartKind} from "../../../contracts";
import {
  EFinishReason,
  EMessageRole,
} from "../../../internal/llm-client";
import {
  IRun,
  ERunStatus,
} from "../../../internal/run-store";

import {InMemoryRunRepository} from "../InMemoryRunRepository";

const makeRun = (tenantId: string, runId: string, overrides: Partial<IRun> = {}): IRun => ({
  id: runId,
  tenantId,
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
  steps: 1,
  createdAt: new Date(1_000),
  updatedAt: new Date(1_000),
  ...overrides,
});

const saveRuns = async (repository: InMemoryRunRepository, runs: IRun[]): Promise<void> => {
  for (const run of runs) await repository.save({run});
};

describe("InMemoryRunRepository", () => {
  test("load returns the saved run", async () => {
    const repository = new InMemoryRunRepository();
    await saveRuns(repository, [makeRun("tenant-a", "run-1")]);
    expect(await repository.load({
      tenantId: "tenant-a",
      runId: "run-1",
    })).toEqual(makeRun("tenant-a", "run-1"));
  });

  test("load returns null when the run does not exist", async () => {
    const repository = new InMemoryRunRepository();
    expect(await repository.load({
      tenantId: "tenant-a",
      runId: "missing",
    })).toBeNull();
  });

  test("load returns null for a run of another tenant", async () => {
    const repository = new InMemoryRunRepository();
    await saveRuns(repository, [makeRun("tenant-a", "run-1")]);
    expect(await repository.load({
      tenantId: "tenant-b",
      runId: "run-1",
    })).toBeNull();
  });

  test("save replaces the run with the same runId", async () => {
    const repository = new InMemoryRunRepository();
    await saveRuns(repository, [makeRun("tenant-a", "run-1"), makeRun("tenant-a", "run-1", {status: ERunStatus.DONE})]);
    const run = await repository.load({
      tenantId: "tenant-a",
      runId: "run-1",
    });
    expect(run?.status).toBe(ERunStatus.DONE);
  });

  test("listByStatus returns only the runs of that tenant with that status", async () => {
    const repository = new InMemoryRunRepository();
    await saveRuns(repository, [
      makeRun("tenant-a", "run-1"),
      makeRun("tenant-a", "run-2", {status: ERunStatus.DONE}),
      makeRun("tenant-b", "run-3"),
    ]);
    const runs = await repository.listByStatus({
      tenantId: "tenant-a",
      status: ERunStatus.PAUSED,
    });
    expect(runs.map(run => run.id)).toEqual(["run-1"]);
  });

  test("listByStatus narrows to one user when userId is given", async () => {
    const repository = new InMemoryRunRepository();
    await saveRuns(repository, [makeRun("tenant-a", "run-1"), makeRun("tenant-a", "run-2", {userId: "user-b"})]);
    const runs = await repository.listByStatus({
      tenantId: "tenant-a",
      status: ERunStatus.PAUSED,
      userId: "user-b",
    });
    expect(runs.map(run => run.id)).toEqual(["run-2"]);
  });

  describe("by user (GDPR)", () => {
    const owner = {
      tenantId: "tenant-a",
      userId: "user-a",
    };
    const seed = async (): Promise<InMemoryRunRepository> => {
      const repository = new InMemoryRunRepository();
      await saveRuns(repository, [
        makeRun("tenant-a", "run-1", {
          messages: [{
            role: EMessageRole.USER,
            parts: [{
              kind: EPartKind.TEXT,
              text: "Refund invoice 4521",
            }],
          }],
          request: {
            modelId: "model-a",
            system: [{text: "The user is Dennis"}],
            maxOutputTokens: 500,
          },
          answer: {
            result: {
              modelId: "model-a",
              text: "Refunded.",
              toolCalls: [],
              finishReason: EFinishReason.STOP,
              usage: {
                inputTokens: 10,
                outputTokens: 2,
              },
              latencyMs: 5,
              traceId: "trace-1",
            },
            chunkIds: [],
            issues: [],
          },
        }),
        makeRun("tenant-a", "run-2", {status: ERunStatus.DONE}),
        makeRun("tenant-a", "run-3", {userId: "user-b"}),
        makeRun("tenant-b", "run-4"),
      ]);
      return repository;
    };
    const loadStatuses = async (repository: InMemoryRunRepository, runIds: string[]): Promise<Array<ERunStatus | null>> =>
      Promise.all(runIds.map(async runId => (await repository.load({
        tenantId: runId === "run-4" ? "tenant-b" : "tenant-a",
        runId,
      }))?.status ?? null));

    test("delete all of a user removes the user's runs of the tenant only and counts them", async () => {
      const repository = await seed();
      expect(await repository.delete({
        ...owner,
        threadIds: "all",
      })).toBe(2);
      expect(await loadStatuses(repository, ["run-1", "run-2", "run-3", "run-4"]))
        .toEqual([null, null, ERunStatus.PAUSED, ERunStatus.PAUSED]);
    });

    test("anonymizeByUser keeps the skeleton under the pseudonym without messages, system prompt or answer; a paused run is cancelled", async () => {
      const repository = await seed();
      expect(await repository.anonymizeByUser({
        ...owner,
        pseudonym: "@anon-1",
      })).toBe(2);
      const run = await repository.load({
        tenantId: "tenant-a",
        runId: "run-1",
      });
      expect(run).toMatchObject({
        userId: "@anon-1",
        status: ERunStatus.CANCELLED,
        messages: [],
        request: {
          modelId: "model-a",
          system: [],
          maxOutputTokens: 500,
        },
        steps: 1,
      });
      expect([run?.pending, run?.answer]).toEqual([undefined, undefined]);
    });

    test("anonymizeByUser keeps the status of a finished run and touches no other user", async () => {
      const repository = await seed();
      await repository.anonymizeByUser({
        ...owner,
        pseudonym: "@anon-1",
      });
      expect(await loadStatuses(repository, ["run-2", "run-3", "run-4"])).toEqual([ERunStatus.DONE, ERunStatus.PAUSED, ERunStatus.PAUSED]);
      expect((await repository.load({
        tenantId: "tenant-a",
        runId: "run-3",
      }))?.userId).toBe("user-b");
    });
  });
});
