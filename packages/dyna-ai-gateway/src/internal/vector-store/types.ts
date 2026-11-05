import {IChunk} from "../../contracts";

/** Configuration of the VectorStore. Lands in IAIGatewayConfig.vectorStore. */
export interface IVectorStoreConfig {
  /** The index backend: the host's adapter; `InMemoryVectorIndexAdapter` ships with the gateway. */
  adapter: IVectorIndexAdapter;
  /**
   * The name of the index, for an adapter that hosts several.
   *
   * Not read by the gateway today: the adapter is constructed by the host and knows its index.
   *
   * @default "kb_chunks"
   */
  indexName?: string;
}

/**
 * Tenant-filtered vector index of KB chunks.
 *
 * Implemented by `VectorStore`; the type of `IAIGatewayDeps.vectorStore`, so a host may pass its own in `overrides`.
 */
export interface IVectorStore {
  /**
   * upsertChunks -- stores the chunks of a document with their vectors
   *
   * # About
   *
   * > Nothing enters the index that cannot be compared with what is there.
   *
   * Inserts or replaces the records by chunk id. Refuses the whole call before any write when a record belongs to
   * another tenant (error 5372772694716) or when its vector was made by another embedding model or has another length
   * than the index (error 5372772694902), both 400. An empty list is a no-op without a call to the adapter.
   *
   * # Who needs it
   *
   * `KbIngestor.ingestDocument`, after `deleteByDoc` removed the document's old chunks.
   *
   * # Pitfalls
   *
   * The check is per call, not per record: one bad record and nothing of the batch is written.
   */
  upsertChunks(
    {
      tenantId,
      records,
    }: {
      tenantId: string;
      records: IChunkRecord[];
    },
  ): Promise<void>;

  /**
   * deleteByDoc -- removes every chunk of one document
   *
   * # About
   *
   * > The document is gone or about to be replaced; its chunks go first.
   *
   * Passes through to the adapter and returns the number of chunks removed; 0 for an unknown document.
   *
   * # Who needs it
   *
   * `KbIngestor.ingestDocument` (before the new chunks are written) and `KbIngestor.removeDocument`.
   */
  deleteByDoc(
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
   * > Metadata only: the vectors stay, no re-embedding (D22).
   *
   * Sets `libraryId` on every chunk of the book through the adapter and returns the number of chunks changed.
   *
   * # Who needs it
   *
   * `KbIngestor.moveBook`.
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
   * describeIndex -- the embedding model and vector length the index was created with
   *
   * # About
   *
   * > The ruler of the index, to compare with the Embedder's.
   *
   * Passes through to the adapter's `describe`.
   *
   * # Who needs it
   *
   * `KbIngestor.checkIndex`, before every ingest; `upsertChunks` and `search`, for their own checks.
   */
  describeIndex(): Promise<IVectorIndexInfo>;

  /**
   * search -- the nearest chunks of a tenant for a query vector
   *
   * # About
   *
   * > The k closest chunks inside the scope the caller named, best first.
   *
   * Filters by tenant and by `filters` (libraries, books, tags, language), returns at most `k` hits with their score.
   * An empty `filters.libraryIds` finds nothing, without asking the index: a scope that came out empty by accident never
   * opens every library. A vector of another length than the index is a 400 (error 5372772695100).
   *
   * # Who needs it
   *
   * `KbRetriever.retrieve`, once per call with a knowledge base, with the vector of the rewritten query.
   *
   * # Pitfalls
   *
   * `k` is the adapter's cut; the retriever drops hits under `minScore` afterwards, so fewer than `k` may reach the prompt.
   */
  search(
    {
      tenantId,
      vector,
      k,
      filters,
    }: {
      tenantId: string;
      vector: number[];
      k: number;
      filters: IChunkFilters;
    },
  ): Promise<IChunkHit[]>;
}

/** The index backend seam: what a host implements over its vector database; the `VectorStore` checks, the adapter stores. */
export interface IVectorIndexAdapter {
  /**
   * upsert -- inserts or replaces chunk records
   *
   * # About
   *
   * > By chunk id within the tenant.
   *
   * The store has checked tenant, model and dimensions already; the adapter writes.
   *
   * # Who needs it
   *
   * `VectorStore.upsertChunks`, for the KB ingestion.
   */
  upsert(args: {
    tenantId: string;
    records: IChunkRecord[];
  }): Promise<void>;
  /**
   * deleteByDoc -- removes every chunk of a document
   *
   * # About
   *
   * > By `docId` within the tenant; returns the count.
   *
   * A re-ingest deletes first, so a shorter document leaves no stale chunks behind.
   *
   * # Who needs it
   *
   * `VectorStore.deleteByDoc`.
   */
  deleteByDoc(args: {
    tenantId: string;
    docId: string;
  }): Promise<number>;
  /**
   * search -- the k nearest chunks of a tenant
   *
   * # About
   *
   * > Best first, filtered by library, book, tags and language.
   *
   * Only the tenant's records are searched; the filters are AND-ed as `IChunkFilters` says; the score is `IChunkHit.score`:
   * 0..1, best 1.
   *
   * # Who needs it
   *
   * `VectorStore.search`, for the KB retrieval.
   */
  search(args: {
    tenantId: string;
    vector: number[];
    k: number;
    filters: IChunkFilters;
  }): Promise<IChunkHit[]>;
  /**
   * moveBook -- sets another library on every chunk of a book
   *
   * # About
   *
   * > Metadata only, the vectors stay.
   *
   * Returns the number of chunks changed.
   *
   * # Who needs it
   *
   * `VectorStore.moveBook`.
   */
  moveBook(args: {
    tenantId: string;
    bookId: string;
    libraryId: string;
  }): Promise<number>;
  /**
   * describe -- model and dimensions of the index
   *
   * # About
   *
   * > What the index was created with.
   *
   * Compared with the `Embedder`'s model before every ingest, so a vector of another model is never written.
   *
   * # Who needs it
   *
   * `VectorStore.describeIndex`.
   */
  describe(): Promise<IVectorIndexInfo>;
}

/** Facts about the index; used to detect an embedding-model mismatch. */
export interface IVectorIndexInfo {
  /** The model whose vectors the index holds. */
  embeddingModelId: string;
  /** The length of every vector in the index. */
  dimensions: number;
}

/** A stored chunk: content plus vector plus tenant. */
export interface IChunkRecord {
  /** The owner; every search is filtered by it. */
  tenantId: string;
  /** The chunk as the `MdChunker` cut it; what a search returns. */
  chunk: IChunk;
  /** The embedding of the chunk's heading path and text, `dimensions` long. */
  vector: number[];
  /** Model that produced the vector. */
  embeddingModelId: string;
}

/**
 * The knowledge-base scope of a search: which libraries and books, AND-ed with the optional tags and language.
 * The gateway does not know which libraries and books exist or who may read them: the caller decides the scope on every call.
 */
export interface IChunkFilters {
  /**
   * The libraries to search; a chunk matches when it is in any of them. One id covers every book of a library.
   * "all" = every library of the tenant, and it has to be written out.
   * Empty array = nothing is searched (no KB for this call) — a list that came out empty by accident never opens every library.
   */
  libraryIds: string[] | "all";
  /** Narrows to single books inside those libraries. Empty array = all their books. */
  bookIds: string[];
  /** Narrows to chunks whose document carries one of these tags. Absent = any. */
  tags?: string[];
  /** BCP-47. */
  language?: string;
}

/** One search result. */
export interface IChunkHit {
  /** The stored chunk. */
  chunk: IChunk;
  /** Similarity 0..1, best 1: the cosine mapped to (1 + cosine) / 2, as Atlas Vector Search scores it; `minScore` compares with it. */
  score: number;
}
