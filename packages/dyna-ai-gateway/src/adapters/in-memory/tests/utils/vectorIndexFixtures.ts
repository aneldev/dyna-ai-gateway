import {
  IChunkFilters,
  IChunkRecord,
} from "../../../../internal/vector-store";

import {InMemoryVectorIndexAdapter} from "../../InMemoryVectorIndexAdapter";

export interface IRecordSeed {
  chunkId: string;
  vector: number[];
  bookId?: string;
  libraryId?: string;
  tags?: string[];
  language?: string;
}

const makeRecord = (seed: IRecordSeed): IChunkRecord => ({
  tenantId: "tenant-a",
  chunk: {
    id: seed.chunkId,
    docId: "doc-1",
    bookId: seed.bookId ?? "book-1",
    libraryId: seed.libraryId ?? "library-1",
    headingPath: "Refunds",
    text: `Text of ${seed.chunkId}`,
    order: 0,
    tokens: 10,
    tags: seed.tags ?? [],
    language: seed.language ?? "en",
  },
  vector: seed.vector,
  embeddingModelId: "embedding-a",
});

export const makeAdapter = async (seeds: IRecordSeed[]): Promise<InMemoryVectorIndexAdapter> => {
  const adapter = new InMemoryVectorIndexAdapter({
    embeddingModelId: "embedding-a",
    dimensions: 2,
  });
  await adapter.upsert({
    tenantId: "tenant-a",
    records: seeds.map(makeRecord),
  });
  return adapter;
};

/** Every library, every book: the scope a test narrows from. */
export const allLibraries: IChunkFilters = {
  libraryIds: "all",
  bookIds: [],
};

export const searchIds = async (adapter: InMemoryVectorIndexAdapter, filters: Partial<IChunkFilters> = {}, k = 10): Promise<string[]> => {
  const hits = await adapter.search({
    tenantId: "tenant-a",
    vector: [1, 0],
    k,
    filters: {
      ...allLibraries,
      ...filters,
    },
  });
  return hits.map(hit => hit.chunk.id);
};
