import {IChunk} from "../../contracts";

/** Configuration of the MdChunker. Lands in IAIGatewayConfig.mdChunker. */
export interface IMdChunkerConfig {
  /** Target size. Default 600. */
  maxTokens?: number;
  /** Below this a section merges with its neighbour. Default 100. */
  minTokens?: number;
  /** Overlap between consecutive chunks of one section. Default 80. */
  overlapTokens?: number;
}

/**
 * Markdown → IChunk[]. Stateless.
 *
 * Implemented by `MdChunker`; the type of `IAIGatewayDeps.mdChunker`, so a host may pass its own in `overrides`.
 */
export interface IMdChunker {
  /**
   * Splits a document; chunk ids are deterministic per docId + order (`docId#order`).
   * One chunk per heading section; a section under minTokens merges with its neighbour, a section over maxTokens is cut at
   * paragraph, then sentence borders, the pieces overlapping by up to overlapTokens. A fenced code block is never cut,
   * so a chunk that holds one can be larger than maxTokens.
   */
  chunk(
    {doc}: {doc: IKbDocument},
  ): IChunk[];

  /** Token count of a text with the same estimator used for chunking: characters / 4, rounded up. */
  countTokens(
    {text}: {text: string},
  ): number;
}

/** Input document for chunking. Produced by the KB editor. */
export interface IKbDocument {
  id: string;
  libraryId: string;
  bookId: string;
  title: string;
  markdown: string;
  tags: string[];
  /** BCP-47. */
  language: string;
}
