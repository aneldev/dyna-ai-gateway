import {IChunk} from "../../../contracts";

import {MdChunker} from "../MdChunker";
import {
  IKbDocument,
  IMdChunkerConfig,
} from "../types";

const makeDoc = (markdown: string, overrides: Partial<IKbDocument> = {}): IKbDocument => ({
  id: "doc-1",
  bookId: "book-1",
  libraryId: "tax",
  title: "Refund guide",
  markdown,
  tags: ["refunds"],
  language: "en",
  ...overrides,
});

/** Small numbers, so a test document stays readable: 1 token = 4 characters. */
const smallConfig: IMdChunkerConfig = {
  maxTokens: 20,
  minTokens: 5,
  overlapTokens: 0,
};

const chunk = (markdown: string, config: IMdChunkerConfig = smallConfig, overrides: Partial<IKbDocument> = {}): IChunk[] =>
  new MdChunker(config).chunk({doc: makeDoc(markdown, overrides)});

/** A sentence of exactly `chars` characters, ending with a full stop. */
const sentence = (word: string, chars: number): string => `${word.repeat(chars).slice(0, chars - 1)}.`;

describe("MdChunker", () => {
  describe("M5 — countTokens", () => {
    test("is the characters divided by 4, rounded up", () => {
      const chunker = new MdChunker({});
      expect(["", "abcd", "abcde"].map(text => chunker.countTokens({text}))).toEqual([0, 1, 2]);
    });
  });

  describe("M5 — chunk: sections", () => {
    const twoSections = [
      "# Refunds",
      sentence("a", 40),
      "## Time limits",
      sentence("b", 40),
    ].join("\n");

    test("gives one chunk per heading section, with the text under the heading", () => {
      expect(chunk(twoSections).map(piece => piece.text)).toEqual([sentence("a", 40), sentence("b", 40)]);
    });

    test("the heading path is the title and the headings above the text", () => {
      expect(chunk(twoSections).map(piece => piece.headingPath)).toEqual(["Refund guide > Refunds", "Refund guide > Refunds > Time limits"]);
    });

    test("the title is not repeated when the first heading is the title", () => {
      expect(chunk(`# Refund guide\n${sentence("a", 40)}`)[0].headingPath).toBe("Refund guide");
    });

    test("a heading of the same or a higher level closes the headings below it", () => {
      const markdown = ["# A", "## A1", sentence("a", 40), "## A2", sentence("b", 40), "# B", sentence("c", 40)].join("\n");
      expect(chunk(markdown).map(piece => piece.headingPath)).toEqual(["Refund guide > A > A1", "Refund guide > A > A2", "Refund guide > B"]);
    });

    test("text before the first heading is a chunk under the title", () => {
      expect(chunk(`${sentence("a", 40)}\n# Refunds\n${sentence("b", 40)}`).map(piece => piece.headingPath)).toEqual(["Refund guide", "Refund guide > Refunds"]);
    });

    test("a document without headings is chunked under its title", () => {
      expect(chunk(sentence("a", 40)).map(piece => [piece.headingPath, piece.text])).toEqual([["Refund guide", sentence("a", 40)]]);
    });

    test("a heading without text of its own gives no chunk", () => {
      expect(chunk(`# Refunds\n## Time limits\n${sentence("a", 40)}`)).toHaveLength(1);
    });

    test("a # line inside a fenced code block is not a heading", () => {
      const markdown = ["# Setup", "```", "# install", "pnpm install", "```"].join("\n");
      expect(chunk(markdown).map(piece => [piece.headingPath, piece.text.includes("# install")])).toEqual([["Refund guide > Setup", true]]);
    });

    test("an empty document gives no chunks", () => {
      expect(chunk("  \n")).toEqual([]);
    });
  });

  describe("M5 — chunk: ids and metadata", () => {
    const markdown = ["# A", sentence("a", 40), "# B", sentence("b", 40)].join("\n");

    test("chunk ids are deterministic: docId#order, the same for the same document", () => {
      expect([chunk(markdown).map(piece => piece.id), chunk(markdown).map(piece => piece.id)]).toEqual([["doc-1#0", "doc-1#1"], ["doc-1#0", "doc-1#1"]]);
    });

    test("every chunk carries the document, book and library ids, the tags, the language and its order", () => {
      expect(chunk(markdown)[1]).toMatchObject({
        docId: "doc-1",
        bookId: "book-1",
        libraryId: "tax",
        tags: ["refunds"],
        language: "en",
        order: 1,
      });
    });

    test("tokens is the token count of the chunk's text", () => {
      expect(chunk(markdown).map(piece => piece.tokens)).toEqual([10, 10]);
    });
  });

  describe("M5 — chunk: sizes", () => {
    test("chunk sizes stay within maxTokens", () => {
      const markdown = `# Long\n${Array.from({length: 12}, (_item, index) => sentence(String(index % 10), 30)).join(" ")}`;
      const pieces = chunk(markdown);
      expect([pieces.length > 1, pieces.every(piece => piece.tokens <= 20)]).toEqual([true, true]);
    });

    test("a long section is cut between paragraphs when they fit", () => {
      const markdown = `# Long\n${sentence("a", 60)}\n\n${sentence("b", 60)}`;
      expect(chunk(markdown).map(piece => piece.text)).toEqual([sentence("a", 60), sentence("b", 60)]);
    });

    test("a paragraph that is too long is cut between sentences, never inside one that fits", () => {
      const markdown = `# Long\n${sentence("a", 50)} ${sentence("b", 50)}`;
      expect(chunk(markdown).map(piece => piece.text)).toEqual([sentence("a", 50), sentence("b", 50)]);
    });

    test("a list that is too long is cut between its items", () => {
      const items = ["- " + "a".repeat(36), "- " + "b".repeat(36), "- " + "c".repeat(36)];
      expect(chunk(`# List\n${items.join("\n")}`).map(piece => piece.text)).toEqual([`${items[0]}\n${items[1]}`, items[2]]);
    });

    test("a sentence that is too long is cut between words", () => {
      const words = Array.from({length: 30}, () => "word").join(" ");
      const pieces = chunk(`# Long\n${words}`);
      expect([pieces.every(piece => piece.tokens <= 20), pieces.map(piece => piece.text).join(" ")]).toEqual([true, words]);
    });

    test("a fenced code block is never cut, even when it is larger than maxTokens", () => {
      const code = ["```", "a".repeat(60), "", "b".repeat(60), "```"].join("\n");
      expect(chunk(`# Code\n${code}`).map(piece => piece.text)).toEqual([code]);
    });

    test("all pieces of one section have the section's heading path", () => {
      const markdown = `# Long\n${sentence("a", 60)}\n\n${sentence("b", 60)}`;
      expect(chunk(markdown).map(piece => piece.headingPath)).toEqual(["Refund guide > Long", "Refund guide > Long"]);
    });
  });

  describe("M5 — chunk: overlap", () => {
    const config: IMdChunkerConfig = {
      maxTokens: 20,
      minTokens: 0,
      overlapTokens: 8,
    };
    const sentences = ["a", "b", "c", "d"].map(letter => sentence(letter, 28));

    test("the next piece of a section starts with the end of the piece before it", () => {
      expect(chunk(`# Long\n${sentences.join(" ")}`, config).map(piece => piece.text)).toEqual([
        `${sentences[0]} ${sentences[1]}`,
        `${sentences[1]} ${sentences[2]}`,
        `${sentences[2]} ${sentences[3]}`,
      ]);
    });

    test("pieces of different sections do not overlap", () => {
      const markdown = `# A\n${sentence("a", 40)}\n# B\n${sentence("b", 40)}`;
      expect(chunk(markdown, config).map(piece => piece.text)).toEqual([sentence("a", 40), sentence("b", 40)]);
    });

    test("with the overlap every piece still fits in maxTokens", () => {
      expect(chunk(`# Long\n${sentences.join(" ")}`, config).every(piece => piece.tokens <= 20)).toBe(true);
    });
  });

  describe("M5 — chunk: small sections", () => {
    test("a section under minTokens joins the section before it, with its heading line", () => {
      const markdown = ["# A", sentence("a", 40), "## Note", "Short."].join("\n");
      expect(chunk(markdown).map(piece => [piece.headingPath, piece.text])).toEqual([
        ["Refund guide > A", `# A\n${sentence("a", 40)}\n\n## Note\nShort.`],
      ]);
    });

    test("a small first section is carried into the next one, which gives the heading path", () => {
      const markdown = ["# Intro", "Short.", "# Refunds", sentence("b", 40)].join("\n");
      expect(chunk(markdown).map(piece => [piece.headingPath, piece.text])).toEqual([
        ["Refund guide > Refunds", `# Intro\nShort.\n\n# Refunds\n${sentence("b", 40)}`],
      ]);
    });

    test("a small section does not join a neighbour when the two would not fit in maxTokens", () => {
      const markdown = ["# A", sentence("a", 76), "# Note", "Short."].join("\n");
      expect(chunk(markdown).map(piece => piece.text)).toEqual([sentence("a", 76), "Short."]);
    });

    test("a document that is small as a whole stays one chunk", () => {
      expect(chunk("# A\nShort.").map(piece => piece.text)).toEqual(["Short."]);
    });
  });

  describe("M5 — config", () => {
    test("the defaults are 600 / 100 / 80 tokens: a section of 500 tokens stays whole", () => {
      const pieces = new MdChunker({}).chunk({doc: makeDoc(`# A\n${Array.from({length: 50}, () => sentence("a", 40)).join(" ")}`)});
      expect(pieces.map(piece => piece.tokens)).toEqual([513]);
    });

    test.each([
      [{maxTokens: 0}],
      [{
        maxTokens: 10,
        minTokens: 10,
      }],
      [{
        maxTokens: 10,
        overlapTokens: 10,
      }],
    ])("a config that cannot work is refused with a 400 (%j)", config => {
      expect(() => new MdChunker(config)).toThrow(expect.objectContaining({
        code: 5372621037192,
        status: 400,
      }));
    });
  });
});
