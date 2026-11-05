import {
  IKbDocument,
  IMdChunker,
} from "../md-chunker";
import {IEmbedder} from "../embedder";
import {IVectorStore} from "../vector-store";

/** Configuration of the KbIngestor. Lands in IAIGatewayConfig.kbIngestor. */
export interface IKbIngestorConfig {
  /**
   * Documents `reindexBook` ingests in parallel.
   *
   * > Two keep the provider busy without tripping its rate limit; more is the usage adapter's and the provider's call.
   *
   * @default 2
   */
  concurrency?: number;
}

/** Shared instances KbIngestor needs; created once by AIGateway and passed as the second constructor argument. */
export interface IKbIngestorDeps {
  /** Markdown → chunks. */
  mdChunker: IMdChunker;
  /** Chunks → vectors (`embed`), and the ruler the index is checked against. */
  embedder: IEmbedder;
  /** The index: `deleteByDoc`, `upsertChunks`, `moveBook`, `describeIndex`. */
  vectorStore: IVectorStore;
}

/**
 * KB write path: MD → chunks → vectors → index.
 *
 * Implemented by `KbIngestor`; the type of `IAIGatewayDeps.kbIngestor`, so a host may pass its own in `overrides`.
 */
export interface IKbIngestor {
  /**
   * ingestDocument -- replaces a document's chunks in the index
   *
   * # About
   *
   * > Chunk, embed, then swap the old chunks for the new ones.
   *
   * Chunks the document, embeds heading path + text of every chunk, deletes the document's old chunks and stores the
   * new ones with the `Embedder`'s model id. The delete comes after the embedding, so a failed embedding leaves the
   * index as it was. Returns the counts, the estimated tokens embedded and the duration.
   *
   * Throws a 400 before any model call when the `Embedder` and the index do not use the same embedding model and
   * dimensions (error 5372774697006), and the usage adapter's refusal of the embedding (a 429 whose `code` is
   * `USAGE_DENIED_ERROR_CODE`, `data.denyCode` the app's code) before anything is written.
   *
   * # Who needs it
   *
   * The application's document save endpoint, through `AIGateway.kbIngestor`; `reindexBook`, per document.
   *
   * # Pitfalls
   *
   * Between the delete and the upsert the document is briefly absent from the index: a search in that window misses
   * it. One document is one `embed` call per `batchSize` chunks, each checked by the usage adapter.
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

  /**
   * removeDocument -- removes a document from the index
   *
   * # About
   *
   * > The document was deleted in the editor; its chunks go.
   *
   * `VectorStore.deleteByDoc`; returns the number of chunks removed, 0 for a document that is not in the index.
   *
   * # Who needs it
   *
   * The application's document delete endpoint, through `AIGateway.kbIngestor`.
   */
  removeDocument(
    {
      tenantId,
      docId,
    }: {
      tenantId: string;
      docId: string;
    },
  ): Promise<number>;

  /**
   * moveBook -- moves a book to another library
   *
   * # About
   *
   * > A new shelf, the same vectors (D22).
   *
   * `VectorStore.moveBook`: changes the `libraryId` of the book's chunks, no embedding. Returns the number of chunks
   * changed; 0 for a book that is not in the index.
   *
   * # Who needs it
   *
   * The application's book move endpoint, through `AIGateway.kbIngestor`.
   */
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
   * reindexBook -- re-ingests every document of a book
   *
   * # About
   *
   * > The embedding model changed, or the book is in doubt: build it again, document by document.
   *
   * `ingestDocument` for every document of `docs`, `concurrency` at a time; one report per document, in the order of
   * `docs`, each also given to `onProgress` as it completes. A document that fails does not stop the book: its report
   * carries the error (logged as 5372774696808) and its old chunks stay in the index.
   *
   * Throws a 400 before anything is ingested when a document is not of the book (error 5372774696616), and the usage
   * adapter's refusal (429) as `ingestDocument` does: the documents ingested before it are in the index, the rest are
   * not.
   *
   * # Who needs it
   *
   * The application's reindex endpoint or job, through `AIGateway.kbIngestor`, after a change of the embedding model
   * or of the chunker settings.
   *
   * # Pitfalls
   *
   * The caller supplies `docs`: the gateway does not know which documents a book holds. A book with documents missing
   * from `docs` keeps their old chunks, embedded with the old ruler, and `upsertChunks` refuses nothing about them.
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
  /** The document ingested. */
  docId: string;
  /** Chunks now in the index for the document; 0 when it failed. */
  chunksWritten: number;
  /** The document's chunks removed before the new ones were written; 0 for a new document. */
  chunksDeleted: number;
  /** Estimated tokens of the texts that were embedded (heading path + chunk text). */
  tokens: number;
  /** Wall time of the ingestion, check and embedding included. */
  durationMs: number;
  /** Only in the reports of reindexBook: why this document was not ingested. Its old chunks are still in the index. */
  error?: string;
}
