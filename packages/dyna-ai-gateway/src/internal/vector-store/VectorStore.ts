import {dynaError} from "dyna-error";

import {
  IChunkFilters,
  IChunkHit,
  IChunkRecord,
  IVectorIndexInfo,
  IVectorStore,
  IVectorStoreConfig,
} from "./types";

/** Tenant-filtered vector index of KB chunks. */
export class VectorStore implements IVectorStore {
  constructor(private readonly config: IVectorStoreConfig) {}

  /**
   * Inserts or replaces records by chunkId.
   * Refuses the whole call (400) when a record belongs to another tenant, or when its vector was made by another embedding
   * model or has another length than the index: such a vector cannot be compared with the ones that are stored.
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

  /** Removes all chunks of a document; returns the count. */
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

  /** Moves a book to another library: the chunks keep their vectors, only their libraryId changes. Returns the number of chunks changed. */
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

  /** Model and dimensions of the index; KbIngestor and Embedder compare against it at startup. */
  public async describeIndex(): Promise<IVectorIndexInfo> {
    return this.config.adapter.describe();
  }

  /**
   * Nearest chunks for a vector, filtered by tenant and metadata, best first.
   * An empty filters.libraryIds finds nothing, without asking the index. A vector of another length than the index is a 400.
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
