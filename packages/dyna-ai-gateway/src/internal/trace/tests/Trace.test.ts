import {InMemoryTraceRepository} from "../../../adapters/in-memory";
import {
  IIssue,
  EIssueSeverity,
} from "../../../contracts";

import {Trace} from "../Trace";
import {
  ITraceEntry,
  ITraceRepository,
  ETraceKind,
} from "../types";

const makeEntry = (id: string, overrides: Partial<ITraceEntry> = {}): ITraceEntry => ({
  id,
  tenantId: "tenant-a",
  userId: "user-a",
  threadId: "thread-1",
  kind: ETraceKind.CHAT,
  modelId: "model-a",
  request: {
    modelId: "model-a",
    system: "You are a test",
    messages: [],
    maxOutputTokens: 500,
  },
  usage: {
    inputTokens: 10,
    outputTokens: 2,
  },
  chunkIds: [],
  issues: [],
  costUsd: 0.01,
  createdAt: new Date(1_000),
  ...overrides,
});

const issue: IIssue = {
  code: "sum_mismatch",
  message: "The lines do not add up",
  severity: EIssueSeverity.WARNING,
};

const loadAll = (trace: Trace): Promise<ITraceEntry[]> =>
  trace.query({
    tenantId: "tenant-a",
    filters: {},
    skip: 0,
    limit: 100,
  });

describe("Trace", () => {
  describe("M3 — record", () => {
    test("stores the entry", async () => {
      const trace = new Trace({repository: new InMemoryTraceRepository()});
      await trace.record({entry: makeEntry("trace-1")});
      expect(await loadAll(trace)).toEqual([makeEntry("trace-1")]);
    });

    test("does not throw when the repository fails, and reports it", async () => {
      const report = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const failing: ITraceRepository = {
        save: async (): Promise<void> => {
          throw new Error("database is down");
        },
        load: async (): Promise<null> => null,
        query: async (): Promise<ITraceEntry[]> => [],
        delete: async (): Promise<number> => 0,
        anonymizeByUser: async (): Promise<number> => 0,
      };
      await expect(new Trace({repository: failing}).record({entry: makeEntry("trace-1")})).resolves.toBeUndefined();
      expect(report).toHaveBeenCalledTimes(1);
      report.mockRestore();
    });
  });

  describe("M3 — annotate", () => {
    test("adds the chunk ids and the issues to the entry", async () => {
      const trace = new Trace({repository: new InMemoryTraceRepository()});
      await trace.record({entry: makeEntry("trace-1")});
      await trace.annotate({
        tenantId: "tenant-a",
        traceId: "trace-1",
        chunkIds: ["chunk-1", "chunk-2"],
        issues: [issue],
      });
      const [entry] = await loadAll(trace);
      expect([entry.chunkIds, entry.issues]).toEqual([["chunk-1", "chunk-2"], [issue]]);
    });

    test("keeps what the entry already had and does not repeat a chunk id", async () => {
      const trace = new Trace({repository: new InMemoryTraceRepository()});
      await trace.record({entry: makeEntry("trace-1", {chunkIds: ["chunk-1"]})});
      await trace.annotate({
        tenantId: "tenant-a",
        traceId: "trace-1",
        chunkIds: ["chunk-1", "chunk-2"],
        issues: [],
      });
      expect((await loadAll(trace))[0].chunkIds).toEqual(["chunk-1", "chunk-2"]);
    });

    test("leaves the rest of the entry as recorded", async () => {
      const trace = new Trace({repository: new InMemoryTraceRepository()});
      await trace.record({entry: makeEntry("trace-1")});
      await trace.annotate({
        tenantId: "tenant-a",
        traceId: "trace-1",
        chunkIds: [],
        issues: [],
      });
      expect(await loadAll(trace)).toEqual([makeEntry("trace-1")]);
    });

    test("throws a 404 with code 5372588039586 for an unknown entry", async () => {
      const trace = new Trace({repository: new InMemoryTraceRepository()});
      await expect(trace.annotate({
        tenantId: "tenant-a",
        traceId: "missing",
        chunkIds: [],
        issues: [],
      })).rejects.toMatchObject({
        code: 5372588039586,
        status: 404,
        data: {
          tenantId: "tenant-a",
          traceId: "missing",
        },
      });
    });
  });

  describe("M3 — query", () => {
    test("returns the tenant's entries that match the filters, paged", async () => {
      const trace = new Trace({repository: new InMemoryTraceRepository()});
      for (const id of ["trace-1", "trace-2", "trace-3"]) await trace.record({entry: makeEntry(id, {kind: ETraceKind.EMBED})});
      await trace.record({entry: makeEntry("trace-4")});
      const entries = await trace.query({
        tenantId: "tenant-a",
        filters: {kind: ETraceKind.EMBED},
        skip: 1,
        limit: 5,
      });
      expect(entries.map(entry => entry.id)).toEqual(["trace-2", "trace-3"]);
    });
  });
});
