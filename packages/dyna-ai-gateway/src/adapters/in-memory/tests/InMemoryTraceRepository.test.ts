import {EFinishReason} from "../../../internal/llm-client";
import {
  ITraceEntry,
  ITraceFilters,
  ETraceKind,
} from "../../../internal/trace";

import {InMemoryTraceRepository} from "../InMemoryTraceRepository";

const makeEntry = (traceId: string, overrides: Partial<ITraceEntry> = {}): ITraceEntry => ({
  id: traceId,
  tenantId: "tenant-a",
  userId: "user-a",
  threadId: "thread-1",
  kind: ETraceKind.CHAT,
  modelId: "model-a",
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

const queryIds = async (
  repository: InMemoryTraceRepository,
  filters: ITraceFilters = {},
  page: {skip: number; limit: number} = {
    skip: 0,
    limit: 10,
  },
): Promise<string[]> => {
  const entries = await repository.query({
    tenantId: "tenant-a",
    filters,
    ...page,
  });
  return entries.map(entry => entry.id);
};

const saveEntries = async (repository: InMemoryTraceRepository, entries: ITraceEntry[]): Promise<void> => {
  for (const entry of entries) await repository.save({entry});
};

describe("InMemoryTraceRepository", () => {
  test("query returns the saved entries of the tenant", async () => {
    const repository = new InMemoryTraceRepository();
    await saveEntries(repository, [makeEntry("trace-1"), makeEntry("trace-2", {tenantId: "tenant-b"})]);
    expect(await queryIds(repository)).toEqual(["trace-1"]);
  });

  test("save replaces the entry with the same traceId", async () => {
    const repository = new InMemoryTraceRepository();
    await saveEntries(repository, [makeEntry("trace-1"), makeEntry("trace-1", {chunkIds: ["chunk-1"]})]);
    const entries = await repository.query({
      tenantId: "tenant-a",
      filters: {},
      skip: 0,
      limit: 10,
    });
    expect(entries).toEqual([makeEntry("trace-1", {chunkIds: ["chunk-1"]})]);
  });

  test("load returns the entry by id", async () => {
    const repository = new InMemoryTraceRepository();
    await saveEntries(repository, [makeEntry("trace-1")]);
    expect(await repository.load({
      tenantId: "tenant-a",
      traceId: "trace-1",
    })).toEqual(makeEntry("trace-1"));
  });

  test("load returns null for an unknown id or another tenant's entry", async () => {
    const repository = new InMemoryTraceRepository();
    await saveEntries(repository, [makeEntry("trace-1", {tenantId: "tenant-b"})]);
    expect(await repository.load({
      tenantId: "tenant-a",
      traceId: "trace-1",
    })).toBeNull();
  });

  test("filters.kind keeps only entries of that kind", async () => {
    const repository = new InMemoryTraceRepository();
    await saveEntries(repository, [makeEntry("trace-1"), makeEntry("trace-2", {kind: ETraceKind.EMBED})]);
    expect(await queryIds(repository, {kind: ETraceKind.EMBED})).toEqual(["trace-2"]);
  });

  test("filters.userId keeps only entries of that user", async () => {
    const repository = new InMemoryTraceRepository();
    await saveEntries(repository, [makeEntry("trace-1"), makeEntry("trace-2", {userId: "user-b"})]);
    expect(await queryIds(repository, {userId: "user-b"})).toEqual(["trace-2"]);
  });

  test("filters.threadId keeps only entries of that thread", async () => {
    const repository = new InMemoryTraceRepository();
    await saveEntries(repository, [makeEntry("trace-1"), makeEntry("trace-2", {threadId: "thread-2"})]);
    expect(await queryIds(repository, {threadId: "thread-2"})).toEqual(["trace-2"]);
  });

  test("filters.from and to keep entries inside the range, bounds included", async () => {
    const repository = new InMemoryTraceRepository();
    await saveEntries(repository, [1_000, 2_000, 3_000, 4_000].map(createdAt => makeEntry(`trace-${createdAt}`, {createdAt: new Date(createdAt)})));
    expect(await queryIds(repository, {
      from: new Date(2_000),
      to: new Date(3_000),
    })).toEqual(["trace-2000", "trace-3000"]);
  });

  test("query applies skip and limit", async () => {
    const repository = new InMemoryTraceRepository();
    await saveEntries(repository, ["trace-1", "trace-2", "trace-3", "trace-4"].map(traceId => makeEntry(traceId)));
    expect(await queryIds(repository, {}, {
      skip: 1,
      limit: 2,
    })).toEqual(["trace-2", "trace-3"]);
  });

  describe("by user (GDPR)", () => {
    const owner = {
      tenantId: "tenant-a",
      userId: "user-a",
    };
    const seed = async (): Promise<InMemoryTraceRepository> => {
      const repository = new InMemoryTraceRepository();
      await saveEntries(repository, [
        makeEntry("trace-1", {
          request: {
            modelId: "model-a",
            system: [{text: "The user is Dennis"}],
            messages: [],
            maxOutputTokens: 500,
          },
          result: {
            modelId: "model-a",
            text: "Hello Dennis",
            toolCalls: [],
            finishReason: EFinishReason.STOP,
            usage: {
              inputTokens: 10,
              outputTokens: 2,
            },
            latencyMs: 5,
            traceId: "trace-1",
          },
        }),
        makeEntry("trace-2", {userId: "user-b"}),
        makeEntry("trace-3", {userId: undefined}),
        makeEntry("trace-4", {tenantId: "tenant-b"}),
      ]);
      return repository;
    };

    test("delete all of a user removes the user's entries of the tenant only; system entries without a user stay", async () => {
      const repository = await seed();
      expect(await repository.delete({
        ...owner,
        threadIds: "all",
      })).toBe(1);
      expect(await queryIds(repository)).toEqual(["trace-2", "trace-3"]);
      expect(await repository.load({
        tenantId: "tenant-b",
        traceId: "trace-4",
      })).not.toBeNull();
    });

    test("anonymizeByUser keeps the audit skeleton under the pseudonym without request and result", async () => {
      const repository = await seed();
      expect(await repository.anonymizeByUser({
        ...owner,
        pseudonym: "@anon-1",
      })).toBe(1);
      expect(await repository.load({
        tenantId: "tenant-a",
        traceId: "trace-1",
      })).toEqual(makeEntry("trace-1", {userId: "@anon-1"}));
      expect(await queryIds(repository, {userId: "user-a"})).toEqual([]);
    });
  });
});
