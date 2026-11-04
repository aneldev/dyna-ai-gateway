import {
  IChunkFilters,
  IChunkHit,
  IChunkRecord,
  IVectorIndexAdapter,
  IVectorIndexInfo,
} from "../../internal/vector-store";

import {makeTenantKey} from "./utils/makeTenantKey";

/**
 * InMemoryVectorIndexAdapter -- the vector index in a Map, for tests and the sandbox
 *
 * # About
 *
 * > A brute-force cosine search over every record: exact, and fine for a few thousand chunks.
 *
 * Implements `IVectorIndexAdapter` so the `VectorStore` runs with no infrastructure. The score is (1 + cosine) / 2, 0..1
 * like Atlas Vector Search, so `minScore` means the same in a test and in production. The filters are AND-ed; `libraryIds`,
 * `bookIds` and `tags` match when the chunk has any of the listed values; `libraryIds` "all" = no restriction and an
 * empty array = no chunk matches, `bookIds` empty = no restriction. The constructor takes what `describe` reports.
 *
 * # Who needs it
 *
 * The gateway tests (`gatewayConfigBase`), the dev sandbox and the cookbook's first run; a host app uses its own adapter.
 *
 * # Pitfalls
 *
 * Production: nothing survives the process, nothing is shared between processes.
 * Every search scans every record of the tenant: a large index belongs in a real vector database.
 */
export class InMemoryVectorIndexAdapter implements IVectorIndexAdapter {
  private readonly records = new Map<string, IChunkRecord>();

  constructor(
    /** What `describe()` reports: the model and dimensions this index is created for. */
    private readonly info: IVectorIndexInfo,
  ) {}

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
  public async upsert(
    {
      tenantId,
      records,
    }: {
      tenantId: string;
      records: IChunkRecord[];
    },
  ): Promise<void> {
    records.forEach(record => {
      this.records.set(
        makeTenantKey(tenantId, record.chunk.id),
        structuredClone({
          ...record,
          tenantId: tenantId,
        }),
      );
    });
  }

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
  public async deleteByDoc(
    {
      tenantId,
      docId,
    }: {
      tenantId: string;
      docId: string;
    },
  ): Promise<number> {
    const keys =
      [...this.records.entries()]
        .filter(([, record]) => record.tenantId === tenantId && record.chunk.docId === docId)
        .map(([key]) => key);
    keys.forEach(key => this.records.delete(key));
    return keys.length;
  }

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
    return [...this.records.values()]
      .filter(record => record.tenantId === tenantId)
      .filter(record => this.matches(record, filters))
      .map((record): IChunkHit => ({
        chunk: structuredClone(record.chunk),
        score: this.getScore(vector, record.vector),
      }))
      .sort((hitA, hitB) => hitB.score - hitA.score)
      .slice(0, k);
  }

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
    const records = [...this.records.values()].filter(record => record.tenantId === tenantId && record.chunk.bookId === bookId);
    records.forEach(record => {
      record.chunk.libraryId = libraryId;
    });
    return records.length;
  }

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
  public async describe(): Promise<IVectorIndexInfo> {
    return {...this.info};
  }

  /** True when the chunk passes the AND-ed filters. */
  private matches(record: IChunkRecord, filters: IChunkFilters): boolean {
    if (filters.libraryIds !== "all" && !filters.libraryIds.includes(record.chunk.libraryId)) return false;
    if (filters.bookIds.length && !filters.bookIds.includes(record.chunk.bookId)) return false;
    if (filters.tags && !filters.tags.some(tag => record.chunk.tags.includes(tag))) return false;
    if (filters.language !== undefined && record.chunk.language !== filters.language) return false;
    return true;
  }

  /** (1 + cosine) / 2 of the two vectors; 0.5 when one of them has no length. */
  private getScore(vectorA: number[], vectorB: number[]): number {
    const dot = vectorA.reduce((sum, value, index) => sum + value * (vectorB[index] ?? 0), 0);
    const norms = this.getNorm(vectorA) * this.getNorm(vectorB);
    const cosine = norms === 0 ? 0 : dot / norms;
    return (1 + cosine) / 2;
  }

  /** The Euclidean length of a vector. */
  private getNorm(vector: number[]): number {
    return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  }
}
