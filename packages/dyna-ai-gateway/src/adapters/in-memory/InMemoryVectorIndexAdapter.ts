import {
  IChunkFilters,
  IChunkHit,
  IChunkRecord,
  IVectorIndexAdapter,
  IVectorIndexInfo,
} from "../../internal/vector-store";

import {makeTenantKey} from "./utils/makeTenantKey";

/**
 * Chunk records in a Map with a brute-force cosine search.
 * Score = (1 + cosine) / 2, so it is 0..1 like Atlas Vector Search.
 * Filters are AND-ed; `libraryIds`, `bookIds` and `tags` match when the chunk has any of the listed values.
 * `libraryIds`: "all" = no restriction, an empty array = no chunk matches. `bookIds`: an empty array = no restriction.
 */
export class InMemoryVectorIndexAdapter implements IVectorIndexAdapter {
  private readonly records = new Map<string, IChunkRecord>();

  constructor(
    /** What `describe()` reports: the model and dimensions this index is created for. */
    private readonly info: IVectorIndexInfo,
  ) {}

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

  public async describe(): Promise<IVectorIndexInfo> {
    return {...this.info};
  }

  private matches(record: IChunkRecord, filters: IChunkFilters): boolean {
    if (filters.libraryIds !== "all" && !filters.libraryIds.includes(record.chunk.libraryId)) return false;
    if (filters.bookIds.length && !filters.bookIds.includes(record.chunk.bookId)) return false;
    if (filters.tags && !filters.tags.some(tag => record.chunk.tags.includes(tag))) return false;
    if (filters.language !== undefined && record.chunk.language !== filters.language) return false;
    return true;
  }

  private getScore(vectorA: number[], vectorB: number[]): number {
    const dot = vectorA.reduce((sum, value, index) => sum + value * (vectorB[index] ?? 0), 0);
    const norms = this.getNorm(vectorA) * this.getNorm(vectorB);
    const cosine = norms === 0 ? 0 : dot / norms;
    return (1 + cosine) / 2;
  }

  private getNorm(vector: number[]): number {
    return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  }
}
