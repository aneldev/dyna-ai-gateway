import {
  IChunk,
  IChunkRecord,
  InMemoryVectorIndexAdapter,
} from "../..";

/**
 * The in-memory vector index that also exposes what is in it: `chunks` is every ingested chunk (no vectors),
 * for the debugger console. The index itself has no listing (search is its only read).
 */
export class DebugVectorIndexAdapter extends InMemoryVectorIndexAdapter {
  private readonly chunksById = new Map<string, IChunk>();

  /** Every chunk of the index, in upsert order. */
  public get chunks(): IChunk[] {
    return [...this.chunksById.values()];
  }

  public async upsert(
    {
      tenantId,
      records,
    }: {
      tenantId: string;
      records: IChunkRecord[];
    },
  ): Promise<void> {
    await super.upsert({
      tenantId,
      records,
    });
    records.forEach(({chunk}) => this.chunksById.set(chunk.id, structuredClone(chunk)));
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
    const deleted = await super.deleteByDoc({
      tenantId,
      docId,
    });
    [...this.chunksById.values()]
      .filter(chunk => chunk.docId === docId)
      .forEach(chunk => this.chunksById.delete(chunk.id));
    return deleted;
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
    const moved = await super.moveBook({
      tenantId,
      bookId,
      libraryId,
    });
    [...this.chunksById.values()]
      .filter(chunk => chunk.bookId === bookId)
      .forEach(chunk => {
        chunk.libraryId = libraryId;
      });
    return moved;
  }
}
