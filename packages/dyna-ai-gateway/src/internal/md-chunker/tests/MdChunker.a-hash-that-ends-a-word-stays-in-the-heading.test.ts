import {MdChunker} from "../MdChunker";

/** Only a closing sequence after a space is stripped (CommonMark): "C#" is a heading's text, "Refunds ##" is "Refunds". */
test("a # that ends a word stays in the heading; a closing sequence after a space is stripped", () => {
  const body = "Text of the section. ".repeat(30);
  const markdown = [
    "## Using C#",
    body,
    "## Refunds ##",
    body,
  ].join("\n");

  const chunks = new MdChunker({}).chunk({
    doc: {
      id: "doc-1",
      bookId: "book-1",
      libraryId: "tax",
      title: "Guide",
      markdown,
      tags: [],
      language: "en",
    },
  });

  expect(chunks.map(chunk => chunk.headingPath)).toEqual(["Guide > Using C#", "Guide > Refunds"]);
});
