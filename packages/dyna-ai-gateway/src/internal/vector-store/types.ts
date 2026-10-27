import {IChunk} from "../../contracts";

/** Configuration of the VectorStore. Lands in IAIGatewayConfig.vectorStore. */
export interface IVectorStoreConfig {
  /** Index backend; Atlas Vector Search in v1. */
  adapter: IVectorIndexAdapter;
  /** Index name. Default "kb_chunks". */
  indexName?: string;
}

/**
 * Tenant-filtered vector index of KB chunks.
 *
 * Implemented by `VectorStore`; the type of `IAIGatewayDeps.vectorStore`, so a host may pass its own in `overrides`.
 */
export interface IVectorStore {
  /**
   * Inserts or replaces records by chunkId.
   * Refuses the whole call (400) when a record belongs to another tenant, or when its vector was made by another embedding
   * model or has another length than the index: such a vector cannot be compared with the ones that are stored.
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

  /** Removes all chunks of a document; returns the count. */
  deleteByDoc(
    {
      tenantId,
      docId,
    }: {
      tenantId: string;
      docId: string;
    },
  ): Promise<number>;

  /** Moves a book to another library: the chunks keep their vectors, only their libraryId changes. Returns the number of chunks changed. */
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

  /** Model and dimensions of the index; KbIngestor and Embedder compare against it at startup. */
  describeIndex(): Promise<IVectorIndexInfo>;

  /**
   * Nearest chunks for a vector, filtered by tenant and metadata, best first.
   * An empty filters.libraryIds finds nothing, without asking the index. A vector of another length than the index is a 400.
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

/** Index backend seam. */
export interface IVectorIndexAdapter {
  upsert(args: {
    tenantId: string;
    records: IChunkRecord[];
  }): Promise<void>;
  deleteByDoc(args: {
    tenantId: string;
    docId: string;
  }): Promise<number>;
  search(args: {
    tenantId: string;
    vector: number[];
    k: number;
    filters: IChunkFilters;
  }): Promise<IChunkHit[]>;
  /** Sets another library on every chunk of a book — metadata only, the vectors stay. Returns the number of chunks changed. */
  moveBook(args: {
    tenantId: string;
    bookId: string;
    libraryId: string;
  }): Promise<number>;
  /** Model and dimensions the index was created with. */
  describe(): Promise<IVectorIndexInfo>;
}

/** Facts about the index; used to detect an embedding-model mismatch. */
export interface IVectorIndexInfo {
  embeddingModelId: string;
  dimensions: number;
}

/** A stored chunk: content plus vector plus tenant. */
export interface IChunkRecord {
  tenantId: string;
  chunk: IChunk;
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
  tags?: string[];
  /** BCP-47. */
  language?: string;
}

/** One search result. */
export interface IChunkHit {
  chunk: IChunk;
  /** Cosine similarity 0..1. */
  score: number;
}
