import {
  allLibraries,
  makeAdapter,
  searchIds,
} from "./utils/vectorIndexFixtures";

describe("InMemoryVectorIndexAdapter — search: score, order, k", () => {
  test("a chunk with the same vector as the query scores 1", async () => {
    const adapter = await makeAdapter([{
      chunkId: "same",
      vector: [1, 0],
    }]);
    const hits = await adapter.search({
      tenantId: "tenant-a",
      vector: [1, 0],
      k: 1,
      filters: allLibraries,
    });
    expect(hits[0].score).toBeCloseTo(1);
  });

  test("a chunk with the opposite vector scores 0", async () => {
    const adapter = await makeAdapter([{
      chunkId: "opposite",
      vector: [-1, 0],
    }]);
    const hits = await adapter.search({
      tenantId: "tenant-a",
      vector: [1, 0],
      k: 1,
      filters: allLibraries,
    });
    expect(hits[0].score).toBeCloseTo(0);
  });

  test("hits are ordered from the nearest to the farthest", async () => {
    const adapter = await makeAdapter([
      {
        chunkId: "far",
        vector: [0, 1],
      },
      {
        chunkId: "near",
        vector: [1, 0],
      },
      {
        chunkId: "middle",
        vector: [1, 1],
      },
    ]);
    expect(await searchIds(adapter)).toEqual(["near", "middle", "far"]);
  });

  test("k limits the number of hits", async () => {
    const adapter = await makeAdapter([
      {
        chunkId: "far",
        vector: [0, 1],
      },
      {
        chunkId: "near",
        vector: [1, 0],
      },
      {
        chunkId: "middle",
        vector: [1, 1],
      },
    ]);
    expect(await searchIds(adapter, {}, 2)).toEqual(["near", "middle"]);
  });
});
