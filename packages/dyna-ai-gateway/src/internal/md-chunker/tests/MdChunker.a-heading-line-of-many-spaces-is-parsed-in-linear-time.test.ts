import {MdChunker} from "../MdChunker";

/**
 * The heading was matched with one regex that backtracked cubically on the spaces of a line: 2 000 spaces took 4 s, and the
 * one event loop of the server was blocked for every tenant. A line of 50 000 spaces is now parsed at once, to the same title.
 */
test("a heading line with 50 000 spaces is chunked in under 200 ms, with its title", () => {
  const markdown = `## Refunds${" ".repeat(50_000)}x\n${"Text of the section. ".repeat(10)}`;
  const chunker = new MdChunker({});

  const startedAt = Date.now();
  const chunks = chunker.chunk({
    doc: {
      id: "doc-1",
      bookId: "book-1",
      libraryId: "tax",
      title: "Refund guide",
      markdown,
      tags: [],
      language: "en",
    },
  });
  const elapsedMs = Date.now() - startedAt;

  expect([elapsedMs < 200, chunks.map(chunk => chunk.headingPath)]).toEqual([true, [`Refund guide > Refunds${" ".repeat(50_000)}x`]]);
});
