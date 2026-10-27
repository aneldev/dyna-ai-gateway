import {
  IKbDocument,
  IMdChunker,
} from "../md-chunker";
import {IEmbedder} from "../embedder";
import {IVectorStore} from "../vector-store";

/** Configuration of the KbIngestor. Lands in IAIGatewayConfig.kbIngestor. */
export interface IKbIngestorConfig {
  /** Documents embedded in parallel. Default 2. */
  concurrency?: number;
}

/** Shared instances KbIngestor needs; created once by AIGateway and passed as the second constructor argument. */
export interface IKbIngestorDeps {
  mdChunker: IMdChunker;
  embedder: IEmbedder;
  vectorStore: IVectorStore;
}

/**
 * KB write path: MD → chunks → vectors → index.
 *
 * Implemented by `KbIngestor`; the type of `IAIGatewayDeps.kbIngestor`, so a host may pass its own in `overrides`.
 */
export interface IKbIngestor {
  /**
   * Replaces a document's chunks in the index: chunk → embed (heading path + text) → delete the old chunks → store the new ones.
   * The old chunks are only deleted after the new ones were embedded, so a failed embedding leaves the index as it was.
   * Throws a 400 before any model call when the Embedder and the index do not use the same embedding model and dimensions, and
   * the usage adapter's refusal of the embedding (a 429 whose `code` is `USAGE_DENIED_ERROR_CODE`, `data.denyCode` the app's code)
   * before anything is written.
   */
  ingestDocument(
    {
      tenantId,
      doc,
      userId,
    }: {
      tenantId: string;
      doc: IKbDocument;
      /** Admin performing the save; goes into the trace of the embed calls. */
      userId?: string;
    },
  ): Promise<IIngestReport>;

  /** Removes a document from the index. Returns the number of chunks removed. */
  removeDocument(
    {
      tenantId,
      docId,
    }: {
      tenantId: string;
      docId: string;
    },
  ): Promise<number>;

  /** Moves a book to another library without embedding it again. Returns the number of chunks changed; 0 for a book that is not in the index. */
  moveBook(
    {
      tenantId,
      bookId,
      libraryId,
    }: {
      tenantId: string;
      bookId: string;
      libraryId: string;
    },
  ): Promise<number>;

  /**
   * Re-ingests every document of a book (e.g. after an embedding model change), config.concurrency documents at a time.
   * A document that fails does not stop the book: its report carries the error, and its old chunks stay in the index.
   * Returns one report per document, in the order of `docs`. Throws a 400, before anything is ingested, when a document is not of the book,
   * and the usage adapter's refusal (429) as `ingestDocument` does: the documents ingested before it are in the index, the rest are not.
   */
  reindexBook(
    {
      tenantId,
      bookId,
      docs,
      userId,
      onProgress,
    }: {
      tenantId: string;
      bookId: string;
      docs: IKbDocument[];
      userId?: string;
      /** Called after each document, failed ones included. */
      onProgress?: (report: IIngestReport) => void;
    },
  ): Promise<IIngestReport[]>;
}

/** Result of one ingestion. */
export interface IIngestReport {
  docId: string;
  chunksWritten: number;
  chunksDeleted: number;
  /** Estimated tokens of the texts that were embedded (heading path + chunk text). */
  tokens: number;
  durationMs: number;
  /** Only in the reports of reindexBook: why this document was not ingested. Its old chunks are still in the index. */
  error?: string;
}
