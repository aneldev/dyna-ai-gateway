import {
  makeAdapter,
  searchIds,
} from "./utils/vectorIndexFixtures";

const seeds = [
  {
    chunkId: "book-1-a",
    vector: [1, 0],
    libraryId: "tax",
    bookId: "book-1",
  },
  {
    chunkId: "book-1-b",
    vector: [0.9, 0.1],
    libraryId: "tax",
    bookId: "book-1",
  },
  {
    chunkId: "book-2-a",
    vector: [1, 0],
    libraryId: "tax",
    bookId: "book-2",
  },
];

const move = {
  tenantId: "tenant-a",
  bookId: "book-1",
  libraryId: "archive",
};

describe("InMemoryVectorIndexAdapter — moveBook", () => {
  test("returns the number of chunks of the book", async () => {
    const adapter = await makeAdapter(seeds);
    expect(await adapter.moveBook(move)).toBe(2);
  });

  test("the chunks of the book are found in the new library and no longer in the old one", async () => {
    const adapter = await makeAdapter(seeds);
    await adapter.moveBook(move);
    expect([
      (await searchIds(adapter, {libraryIds: ["archive"]})).sort(),
      await searchIds(adapter, {libraryIds: ["tax"]}),
    ]).toEqual([["book-1-a", "book-1-b"], ["book-2-a"]]);
  });

  test("the vectors stay: the ranking inside the book is the same after the move", async () => {
    const adapter = await makeAdapter(seeds);
    const before = await searchIds(adapter, {bookIds: ["book-1"]});
    await adapter.moveBook(move);
    expect(await searchIds(adapter, {bookIds: ["book-1"]})).toEqual(before);
  });

  test("a book that is not in the index changes nothing and returns 0", async () => {
    const adapter = await makeAdapter(seeds);
    const moved = await adapter.moveBook({
      ...move,
      bookId: "missing",
    });
    expect([moved, (await searchIds(adapter, {libraryIds: ["tax"]})).length]).toEqual([0, 3]);
  });

  test("the same book id of another tenant is not touched", async () => {
    const adapter = await makeAdapter(seeds);
    const moved = await adapter.moveBook({
      ...move,
      tenantId: "tenant-b",
    });
    expect([moved, (await searchIds(adapter, {libraryIds: ["tax"]})).length]).toEqual([0, 3]);
  });
});
