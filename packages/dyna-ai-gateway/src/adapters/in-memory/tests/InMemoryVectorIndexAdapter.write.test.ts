import {IChunkRecord} from "../../../internal/vector-store";

import {InMemoryVectorIndexAdapter} from "../InMemoryVectorIndexAdapter";

import {allLibraries} from "./utils/vectorIndexFixtures";

const indexInfo = {
  embeddingModelId: "embedding-a",
  dimensions: 2,
};

const makeRecord = (chunkId: string, docId: string, text = "Text"): IChunkRecord => ({
  tenantId: "tenant-a",
  chunk: {
    id: chunkId,
    docId,
    bookId: "book-1",
    libraryId: "library-1",
    headingPath: "Refunds",
    text,
    order: 0,
    tokens: 10,
    tags: [],
    language: "en",
  },
  vector: [1, 0],
  embeddingModelId: "embedding-a",
});

const searchTexts = async (adapter: InMemoryVectorIndexAdapter, tenantId = "tenant-a"): Promise<string[]> => {
  const hits = await adapter.search({
    tenantId,
    vector: [1, 0],
    k: 10,
    filters: allLibraries,
  });
  return hits.map(hit => hit.chunk.text);
};

describe("InMemoryVectorIndexAdapter — describe, upsert, deleteByDoc", () => {
  test("describe returns the model and dimensions given to the constructor", async () => {
    const adapter = new InMemoryVectorIndexAdapter(indexInfo);
    expect(await adapter.describe()).toEqual(indexInfo);
  });

  test("upsert makes the records searchable", async () => {
    const adapter = new InMemoryVectorIndexAdapter(indexInfo);
    await adapter.upsert({
      tenantId: "tenant-a",
      records: [makeRecord("doc-1#0", "doc-1", "First")],
    });
    expect(await searchTexts(adapter)).toEqual(["First"]);
  });

  test("upsert replaces the record with the same chunkId", async () => {
    const adapter = new InMemoryVectorIndexAdapter(indexInfo);
    await adapter.upsert({
      tenantId: "tenant-a",
      records: [makeRecord("doc-1#0", "doc-1", "Old")],
    });
    await adapter.upsert({
      tenantId: "tenant-a",
      records: [makeRecord("doc-1#0", "doc-1", "New")],
    });
    expect(await searchTexts(adapter)).toEqual(["New"]);
  });

  test("upsert stores the records under the tenant of the call", async () => {
    const adapter = new InMemoryVectorIndexAdapter(indexInfo);
    await adapter.upsert({
      tenantId: "tenant-b",
      records: [makeRecord("doc-1#0", "doc-1")],
    });
    expect(await searchTexts(adapter, "tenant-a")).toEqual([]);
  });

  test("deleteByDoc returns the number of removed chunks", async () => {
    const adapter = new InMemoryVectorIndexAdapter(indexInfo);
    await adapter.upsert({
      tenantId: "tenant-a",
      records: [makeRecord("doc-1#0", "doc-1"), makeRecord("doc-1#1", "doc-1"), makeRecord("doc-2#0", "doc-2")],
    });
    expect(await adapter.deleteByDoc({
      tenantId: "tenant-a",
      docId: "doc-1",
    })).toBe(2);
  });

  test("deleteByDoc removes only the chunks of that document", async () => {
    const adapter = new InMemoryVectorIndexAdapter(indexInfo);
    await adapter.upsert({
      tenantId: "tenant-a",
      records: [makeRecord("doc-1#0", "doc-1", "Removed"), makeRecord("doc-2#0", "doc-2", "Kept")],
    });
    await adapter.deleteByDoc({
      tenantId: "tenant-a",
      docId: "doc-1",
    });
    expect(await searchTexts(adapter)).toEqual(["Kept"]);
  });
});
