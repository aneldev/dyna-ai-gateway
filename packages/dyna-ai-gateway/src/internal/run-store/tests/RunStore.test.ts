import {InMemoryRunRepository} from "../../../adapters/in-memory";

import {RunStore} from "../RunStore";
import {
  IRun,
  ERunStatus,
} from "../types";
import {makeRun} from "./utils/runFixtures";

const makeStore = async (runs: IRun[] = []): Promise<RunStore> => {
  const store = new RunStore({repository: new InMemoryRunRepository()});
  for (const run of runs) await store.save({run});
  return store;
};

const load = (store: RunStore, runId: string, tenantId = "tenant-a"): Promise<IRun> =>
  store.load({
    tenantId,
    runId,
  });

describe("RunStore", () => {
  describe("M2", () => {
    test("load returns the saved run", async () => {
      const store = await makeStore([makeRun("run-1")]);
      expect(await load(store, "run-1")).toEqual(makeRun("run-1"));
    });

    test("save replaces the run with the same id", async () => {
      const store = await makeStore([makeRun("run-1"), makeRun("run-1", {steps: 3})]);
      expect((await load(store, "run-1")).steps).toBe(3);
    });

    test("load throws a 404 with code 5372577355245 for an unknown run", async () => {
      const store = await makeStore();
      await expect(load(store, "missing")).rejects.toMatchObject({
        code: 5372577355245,
        status: 404,
        data: {
          tenantId: "tenant-a",
          runId: "missing",
        },
      });
    });

    test("load does not return a run of another tenant", async () => {
      const store = await makeStore([makeRun("run-1")]);
      await expect(load(store, "run-1", "tenant-b")).rejects.toMatchObject({code: 5372577355245});
    });

    test("listPaused returns only the paused runs of the tenant", async () => {
      const store = await makeStore([
        makeRun("run-1", {status: ERunStatus.PAUSED}),
        makeRun("run-2"),
        makeRun("run-3", {
          tenantId: "tenant-b",
          status: ERunStatus.PAUSED,
        }),
      ]);
      expect((await store.listPaused({tenantId: "tenant-a"})).map(run => run.id)).toEqual(["run-1"]);
    });

    test("listPaused narrows to one user when userId is given", async () => {
      const store = await makeStore([
        makeRun("run-1", {status: ERunStatus.PAUSED}),
        makeRun("run-2", {
          status: ERunStatus.PAUSED,
          userId: "user-b",
        }),
      ]);
      expect((await store.listPaused({
        tenantId: "tenant-a",
        userId: "user-b",
      })).map(run => run.id)).toEqual(["run-2"]);
    });

    test("setStatus changes the status and updatedAt, nothing else", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(5_000);
      const store = await makeStore([makeRun("run-1")]);
      await store.setStatus({
        tenantId: "tenant-a",
        runId: "run-1",
        status: ERunStatus.DONE,
      });
      expect(await load(store, "run-1")).toEqual(makeRun("run-1", {
        status: ERunStatus.DONE,
        updatedAt: new Date(5_000),
      }));
      jest.useRealTimers();
    });

    test("setStatus throws the 404 of load for an unknown run", async () => {
      const store = await makeStore();
      await expect(store.setStatus({
        tenantId: "tenant-a",
        runId: "missing",
        status: ERunStatus.DONE,
      })).rejects.toMatchObject({code: 5372577355245});
    });
  });
});
