import {
  makeAdapter,
  searchIds,
} from "./utils/vectorIndexFixtures";

describe("InMemoryVectorIndexAdapter — search: filters", () => {
  const twoLibraries = [
    {
      chunkId: "tax-chunk",
      vector: [1, 0],
      libraryId: "tax",
      bookId: "book-1",
    },
    {
      chunkId: "weather-chunk",
      vector: [1, 0],
      libraryId: "weather",
      bookId: "book-2",
    },
  ];

  test("filters.libraryIds \"all\" searches every library of the tenant", async () => {
    const adapter = await makeAdapter(twoLibraries);
    expect((await searchIds(adapter, {libraryIds: "all"})).sort()).toEqual(["tax-chunk", "weather-chunk"]);
  });

  test("an empty filters.libraryIds finds nothing: an empty list never opens every library", async () => {
    const adapter = await makeAdapter(twoLibraries);
    expect(await searchIds(adapter, {libraryIds: []})).toEqual([]);
  });

  test("an empty filters.bookIds does not narrow: every book of the chosen libraries is searched", async () => {
    const adapter = await makeAdapter(twoLibraries);
    expect(await searchIds(adapter, {
      libraryIds: ["tax"],
      bookIds: [],
    })).toEqual(["tax-chunk"]);
  });

  test("filters.libraryIds keeps the chunks of every book of the listed libraries", async () => {
    const adapter = await makeAdapter([
      {
        chunkId: "tax-book-1",
        vector: [1, 0],
        libraryId: "tax",
        bookId: "book-1",
      },
      {
        chunkId: "tax-book-2",
        vector: [1, 0],
        libraryId: "tax",
        bookId: "book-2",
      },
      {
        chunkId: "weather-book-3",
        vector: [1, 0],
        libraryId: "weather",
        bookId: "book-3",
      },
    ]);
    expect((await searchIds(adapter, {libraryIds: ["tax"]})).sort()).toEqual(["tax-book-1", "tax-book-2"]);
  });

  test("filters.libraryIds and filters.bookIds together narrow to the books inside the library", async () => {
    const adapter = await makeAdapter([
      {
        chunkId: "tax-book-1",
        vector: [1, 0],
        libraryId: "tax",
        bookId: "book-1",
      },
      {
        chunkId: "tax-book-2",
        vector: [1, 0],
        libraryId: "tax",
        bookId: "book-2",
      },
      {
        chunkId: "weather-book-2",
        vector: [1, 0],
        libraryId: "weather",
        bookId: "book-2",
      },
    ]);
    expect(await searchIds(adapter, {
      libraryIds: ["tax"],
      bookIds: ["book-2"],
    })).toEqual(["tax-book-2"]);
  });

  test("filters.bookIds keeps chunks of any listed book", async () => {
    const adapter = await makeAdapter([
      {
        chunkId: "in-book-1",
        vector: [1, 0],
        bookId: "book-1",
      },
      {
        chunkId: "in-book-2",
        vector: [1, 0],
        bookId: "book-2",
      },
    ]);
    expect(await searchIds(adapter, {bookIds: ["book-2"]})).toEqual(["in-book-2"]);
  });

  test("filters.tags keeps chunks that have any listed tag", async () => {
    const adapter = await makeAdapter([
      {
        chunkId: "billing",
        vector: [1, 0],
        tags: ["billing", "refunds"],
      },
      {
        chunkId: "shipping",
        vector: [1, 0],
        tags: ["shipping"],
      },
    ]);
    expect(await searchIds(adapter, {tags: ["refunds", "returns"]})).toEqual(["billing"]);
  });

  test("filters.language keeps chunks of that language", async () => {
    const adapter = await makeAdapter([
      {
        chunkId: "english",
        vector: [1, 0],
        language: "en",
      },
      {
        chunkId: "german",
        vector: [1, 0],
        language: "de-AT",
      },
    ]);
    expect(await searchIds(adapter, {language: "de-AT"})).toEqual(["german"]);
  });

  test("filters are combined with AND", async () => {
    const adapter = await makeAdapter([
      {
        chunkId: "match",
        vector: [1, 0],
        bookId: "book-2",
        language: "de-AT",
      },
      {
        chunkId: "wrong-language",
        vector: [1, 0],
        bookId: "book-2",
        language: "en",
      },
      {
        chunkId: "wrong-book",
        vector: [1, 0],
        bookId: "book-1",
        language: "de-AT",
      },
    ]);
    expect(await searchIds(adapter, {
      bookIds: ["book-2"],
      language: "de-AT",
    })).toEqual(["match"]);
  });
});
