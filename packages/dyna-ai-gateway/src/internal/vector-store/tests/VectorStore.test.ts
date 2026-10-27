import {InMemoryVectorIndexAdapter} from "../../../adapters/in-memory";

import {VectorStore} from "../VectorStore";
import {
  IChunkFilters,
  IChunkRecord,
} from "../types";

const indexInfo = {
  embeddingModelId: "embedding-a",
  dimensions: 2,
};

const everything: IChunkFilters = {
  libraryIds: "all",
  bookIds: [],
};

interface ISetup {
  store: VectorStore;
  adapter: InMemoryVectorIndexAdapter;
}

const setup = (): ISetup => {
  const adapter = new InMemoryVectorIndexAdapter(indexInfo);
  return {
    adapter,
    store: new VectorStore({adapter}),
  };
};

const makeRecord = (chunkId: string, vector: number[], overrides: Partial<IChunkRecord> = {}, chunk: Partial<IChunkRecord["chunk"]> = {}): IChunkRecord => ({
  tenantId: "tenant-a",
  chunk: {
    id: chunkId,
    docId: "doc-1",
    bookId: "book-1",
    libraryId: "tax",
    headingPath: "Refunds",
    text: `Text of ${chunkId}`,
    order: 0,
    tokens: 10,
    tags: [],
    language: "en",
    ...chunk,
  },
  vector,
  embeddingModelId: "embedding-a",
  ...overrides,
});

const upsert = (store: VectorStore, records: IChunkRecord[], tenantId = "tenant-a"): Promise<void> =>
  store.upsertChunks({
    tenantId,
    records,
  });

const searchIds = async (store: VectorStore, filters: IChunkFilters = everything, tenantId = "tenant-a"): Promise<string[]> =>
  (await store.search({
    tenantId,
    vector: [1, 0],
    k: 10,
    filters,
  })).map(hit => hit.chunk.id);

describe("VectorStore", () => {
  describe("M5 — upsertChunks", () => {
    test("stores the records so that a search finds them", async () => {
      const {store} = setup();
      await upsert(store, [makeRecord("doc-1#0", [1, 0])]);
      expect(await searchIds(store)).toEqual(["doc-1#0"]);
    });

    test("a record with the same chunk id replaces the stored one", async () => {
      const {store} = setup();
      await upsert(store, [makeRecord("doc-1#0", [1, 0], {}, {text: "Old"})]);
      await upsert(store, [makeRecord("doc-1#0", [1, 0], {}, {text: "New"})]);
      const hits = await store.search({
        tenantId: "tenant-a",
        vector: [1, 0],
        k: 10,
        filters: everything,
      });
      expect(hits.map(hit => hit.chunk.text)).toEqual(["New"]);
    });

    test("a vector of another embedding model is refused: the index holds one model's vectors", async () => {
      const {store} = setup();
      await expect(upsert(store, [makeRecord("doc-1#0", [1, 0], {embeddingModelId: "embedding-b"})])).rejects.toMatchObject({
        code: 5372772694902,
        status: 400,
        data: {
          index: indexInfo,
          received: {embeddingModelId: "embedding-b"},
        },
      });
    });

    test("a vector of another length than the index is refused", async () => {
      const {store} = setup();
      await expect(upsert(store, [makeRecord("doc-1#0", [1, 0, 0])])).rejects.toMatchObject({code: 5372772694902});
    });

    test("one bad record refuses the whole call: nothing is stored", async () => {
      const {store} = setup();
      await upsert(store, [makeRecord("good", [1, 0]), makeRecord("bad", [1, 0], {embeddingModelId: "embedding-b"})]).catch(() => undefined);
      expect(await searchIds(store)).toEqual([]);
    });

    test("a record of another tenant than the call's is refused", async () => {
      const {store} = setup();
      await expect(upsert(store, [makeRecord("doc-1#0", [1, 0], {tenantId: "tenant-b"})])).rejects.toMatchObject({
        code: 5372772694716,
        status: 400,
      });
    });

    test("no records: the index is not asked", async () => {
      const {
        store,
        adapter,
      } = setup();
      const describe = jest.spyOn(adapter, "describe");
      await upsert(store, []);
      expect(describe).not.toHaveBeenCalled();
    });
  });

  describe("M5 — search", () => {
    test("returns the nearest chunks first, at most k", async () => {
      const {store} = setup();
      await upsert(store, [makeRecord("far", [0, 1]), makeRecord("near", [1, 0]), makeRecord("middle", [1, 1])]);
      const hits = await store.search({
        tenantId: "tenant-a",
        vector: [1, 0],
        k: 2,
        filters: everything,
      });
      expect(hits.map(hit => hit.chunk.id)).toEqual(["near", "middle"]);
    });

    test("finds only the chunks of the tenant", async () => {
      const {store} = setup();
      await upsert(store, [makeRecord("of-a", [1, 0])]);
      await upsert(store, [makeRecord("of-b", [1, 0], {tenantId: "tenant-b"})], "tenant-b");
      expect([await searchIds(store), await searchIds(store, everything, "tenant-b")]).toEqual([["of-a"], ["of-b"]]);
    });

    test("searches only the libraries of the filter", async () => {
      const {store} = setup();
      await upsert(store, [makeRecord("tax-chunk", [1, 0]), makeRecord("weather-chunk", [1, 0], {}, {libraryId: "weather"})]);
      expect(await searchIds(store, {
        libraryIds: ["weather"],
        bookIds: [],
      })).toEqual(["weather-chunk"]);
    });

    test("an empty libraryIds finds nothing and does not ask the index", async () => {
      const {
        store,
        adapter,
      } = setup();
      await upsert(store, [makeRecord("tax-chunk", [1, 0])]);
      const search = jest.spyOn(adapter, "search");
      const ids = await searchIds(store, {
        libraryIds: [],
        bookIds: [],
      });
      expect([ids, search.mock.calls.length]).toEqual([[], 0]);
    });

    test("a query vector of another length than the index is a 400", async () => {
      const {store} = setup();
      await expect(store.search({
        tenantId: "tenant-a",
        vector: [1, 0, 0],
        k: 5,
        filters: everything,
      })).rejects.toMatchObject({
        code: 5372772695100,
        status: 400,
      });
    });
  });

  describe("M5 — deleteByDoc, moveBook, describeIndex", () => {
    test("deleteByDoc removes the chunks of the document and returns their number", async () => {
      const {store} = setup();
      await upsert(store, [makeRecord("doc-1#0", [1, 0]), makeRecord("doc-1#1", [1, 0]), makeRecord("doc-2#0", [1, 0], {}, {docId: "doc-2"})]);
      const removed = await store.deleteByDoc({
        tenantId: "tenant-a",
        docId: "doc-1",
      });
      expect([removed, await searchIds(store)]).toEqual([2, ["doc-2#0"]]);
    });

    test("deleteByDoc does not touch the same document id of another tenant", async () => {
      const {store} = setup();
      await upsert(store, [makeRecord("of-b", [1, 0], {tenantId: "tenant-b"})], "tenant-b");
      const removed = await store.deleteByDoc({
        tenantId: "tenant-a",
        docId: "doc-1",
      });
      expect([removed, await searchIds(store, everything, "tenant-b")]).toEqual([0, ["of-b"]]);
    });

    test("moveBook moves the chunks of the book to the other library and returns their number", async () => {
      const {store} = setup();
      await upsert(store, [makeRecord("book-1-chunk", [1, 0]), makeRecord("book-2-chunk", [1, 0], {}, {bookId: "book-2"})]);
      const moved = await store.moveBook({
        tenantId: "tenant-a",
        bookId: "book-1",
        libraryId: "archive",
      });
      expect([
        moved,
        await searchIds(store, {
          libraryIds: ["archive"],
          bookIds: [],
        }),
        await searchIds(store, {
          libraryIds: ["tax"],
          bookIds: [],
        }),
      ]).toEqual([1, ["book-1-chunk"], ["book-2-chunk"]]);
    });

    test("describeIndex returns the model and the dimensions of the index", async () => {
      expect(await setup().store.describeIndex()).toEqual(indexInfo);
    });
  });
});
