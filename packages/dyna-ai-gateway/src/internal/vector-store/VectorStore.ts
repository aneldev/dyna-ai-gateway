import {dynaError} from "dyna-error";

import {
  IChunkFilters,
  IChunkHit,
  IChunkRecord,
  IVectorIndexInfo,
  IVectorStore,
  IVectorStoreConfig,
} from "./types";

/**
 * VectorStore -- the tenant-filtered vector index of the knowledge-base chunks
 *
 * # About
 *
 * > One shared index, one tenant per query, one ruler for every vector.
 *
 * Implements `IVectorStore` over the host's `IVectorIndexAdapter`: it checks, the adapter stores. The data is grouped as
 * tenant → library → book → document → chunk, and every chunk carries the ids of all its ancestors, so a whole library
 * is searched with one filter value.
 *
 * - `upsertChunks` refuses a record of another tenant, of another embedding model or of another vector length than the
 *   index; `search` refuses a query vector of another length and returns nothing for an empty library scope without
 *   asking the index.
 * - `deleteByDoc`, `moveBook` and `describeIndex` pass through to the adapter.
 *
 * It is the storage end of the knowledge base: the `KbIngestor` writes, the `KbRetriever` reads.
 *
 * # Who needs it
 *
 * `KbIngestor` (`upsertChunks`, `deleteByDoc`, `moveBook`, `describeIndex`) and `KbRetriever.retrieve` (`search`). A host
 * replaces it with its own `IVectorStore` in `overrides.vectorStore`.
 *
 * # What needs
 *
 * Nothing shared: `config.adapter` is the index.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, through the gateway: `createGatewayDeps` creates it from `IAIGatewayConfig.vectorStore`.
 *
 * ## When shouldn't use it
 *
 * A host whose vector database does the tenant and model checks itself may implement `IVectorStore` directly instead of
 * an adapter.
 *
 * # Pitfalls
 *
 * Every write and every search costs one `describe` call on the adapter first; an adapter should answer it from memory.
 * The index is shared across tenants: an adapter that drops the `tenantId` filter leaks data, and the store cannot tell.
 */
export class VectorStore implements IVectorStore {
  constructor(private readonly config: IVectorStoreConfig) {}

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
  public async upsertChunks(
    {
      tenantId,
      records,
    }: {
      tenantId: string;
      records: IChunkRecord[];
    },
  ): Promise<void> {
    if (!records.length) return;
    const index = await this.describeIndex();
    for (const record of records) {
      if (record.tenantId !== tenantId) {
        throw dynaError({
          code: 5372772694716,
          status: 400,
          message: `VectorStore: chunk [${record.chunk.id}] belongs to tenant [${record.tenantId}], not to [${tenantId}]`,
          data: {
            tenantId,
            chunkId: record.chunk.id,
          },
        });
      }
      if (record.embeddingModelId !== index.embeddingModelId || record.vector.length !== index.dimensions) {
        throw dynaError({
          code: 5372772694902,
          status: 400,
          message:
            `VectorStore: chunk [${record.chunk.id}] has a vector of model [${record.embeddingModelId}] with ${record.vector.length} dimensions; ` +
            `the index holds vectors of model [${index.embeddingModelId}] with ${index.dimensions} dimensions`,
          data: {
            chunkId: record.chunk.id,
            index,
            received: {
              embeddingModelId: record.embeddingModelId,
              dimensions: record.vector.length,
            },
          },
        });
      }
    }
    await this.config.adapter.upsert({
      tenantId,
      records,
    });
  }

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
  public async deleteByDoc(
    {
      tenantId,
      docId,
    }: {
      tenantId: string;
      docId: string;
    },
  ): Promise<number> {
    return this.config.adapter.deleteByDoc({
      tenantId,
      docId,
    });
  }

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
  public async moveBook(
    {
      tenantId,
      bookId,
      libraryId,
    }: {
      tenantId: string;
      bookId: string;
      libraryId: string;
    },
  ): Promise<number> {
    return this.config.adapter.moveBook({
      tenantId,
      bookId,
      libraryId,
    });
  }

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
  public async describeIndex(): Promise<IVectorIndexInfo> {
    return this.config.adapter.describe();
  }

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
  public async search(
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
  ): Promise<IChunkHit[]> {
    if (filters.libraryIds !== "all" && !filters.libraryIds.length) return [];
    const index = await this.describeIndex();
    if (vector.length !== index.dimensions) {
      throw dynaError({
        code: 5372772695100,
        status: 400,
        message: `VectorStore: the query vector has ${vector.length} dimensions, the index has ${index.dimensions}`,
        data: {
          index,
          received: vector.length,
        },
      });
    }
    return this.config.adapter.search({
      tenantId,
      vector,
      k,
      filters,
    });
  }
}
