import {IChunk} from "../../contracts";

/** Configuration of the MdChunker. Lands in IAIGatewayConfig.mdChunker. */
export interface IMdChunkerConfig {
  /**
   * The target size of a chunk, in estimated tokens (characters / 4).
   *
   * > Big enough to hold one idea, small enough that several fit the history budget next to the answer.
   *
   * A section over it is cut at paragraph, line, then sentence borders; a fenced code block is never cut, so a chunk that
   * holds one may be larger.
   *
   * @example 600 - a few paragraphs: the default for prose documentation
   * @example 300 - FAQ-style documents with short, self-contained answers
   *
   * @default 600
   */
  maxTokens?: number;
  /**
   * Below this a section merges with its neighbour, so a heading with two lines is not a chunk of its own.
   *
   * @default 100
   */
  minTokens?: number;
  /**
   * The overlap between consecutive pieces of one cut section: the last units of a piece open the next one, so a sentence
   * on the border is whole in one of them.
   *
   * @default 80
   */
  overlapTokens?: number;
}

/**
 * Markdown → IChunk[]. Stateless.
 *
 * Implemented by `MdChunker`; the type of `IAIGatewayDeps.mdChunker`, so a host may pass its own in `overrides`.
 */
export interface IMdChunker {
  /**
   * chunk -- the chunks of one document
   *
   * # About
   *
   * > Headings first, size second, code blocks never cut.
   *
   * One chunk per heading section; a section under `minTokens` merges with its neighbour (the earlier one when the two
   * fit, else it is carried into the next); a section over `maxTokens` is cut at paragraph, line, then sentence
   * borders, the pieces overlapping by up to `overlapTokens`. A fenced code block is never cut, so a chunk that holds
   * one can be larger than `maxTokens`. Chunk ids are `docId#order`, deterministic, so the same document gives the same
   * ids again.
   *
   * # Who needs it
   *
   * `KbIngestor.ingestDocument`, once per saved document, before the texts are embedded.
   *
   * # Pitfalls
   *
   * A document with no heading is one section; a heading with no text of its own gives no chunk but stays in the path of
   * the headings below it. A whole document under `minTokens` stays one small chunk.
   */
  chunk(
    {doc}: {doc: IKbDocument},
  ): IChunk[];

  /**
   * countTokens -- the chunker's own token estimate of a text
   *
   * # About
   *
   * > The same ruler the sizes were cut with.
   *
   * Characters / 4, rounded up: the estimate `maxTokens`, `minTokens` and `overlapTokens` are measured in, and the
   * `tokens` of every chunk.
   *
   * # Who needs it
   *
   * `KbIngestor.ingestDocument`, for the `tokens` of the ingest report; `chunk` itself.
   *
   * # Pitfalls
   *
   * An estimate, not the provider's count: a tokenizer counts code and non-latin text differently.
   */
  countTokens(
    {text}: {text: string},
  ): number;
}

/** Input document for chunking. Produced by the KB editor. */
export interface IKbDocument {
  /** The document's id; the chunk ids are `id#order`, so re-ingesting replaces the old chunks. */
  id: string;
  /** The library of the book, e.g. the tenant's "Tax library". Every chunk of the document carries it. */
  libraryId: string;
  /** The book the document belongs to; every chunk carries it. */
  bookId: string;
  /** The document's title; the first element of every chunk's `headingPath`. */
  title: string;
  /** The content, as the KB editor saved it; split at its ATX headings. */
  markdown: string;
  /** Free tags, copied to every chunk; a search filter. */
  tags: string[];
  /** BCP-47. */
  language: string;
}
