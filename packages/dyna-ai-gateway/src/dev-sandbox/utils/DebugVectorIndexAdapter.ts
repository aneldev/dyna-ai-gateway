import {
  IChunk,
  IChunkRecord,
  InMemoryVectorIndexAdapter,
} from "../..";

/**
 * DebugVectorIndexAdapter -- the in-memory vector index that also lists its chunks
 *
 * # About
 *
 * > `search` is the index's only read; `chunks` is the listing the debugger console wants.
 *
 * `InMemoryVectorIndexAdapter` plus a copy of every ingested chunk (no vectors), kept in step with `upsert`,
 * `deleteByDoc` and `moveBook`, so `dynaEnv.kbChunks` shows what a call can find.
 *
 * # Who needs it
 *
 * `createSandboxAIGateway`, which puts it in the config in place of the given vector adapter.
 */
export class DebugVectorIndexAdapter extends InMemoryVectorIndexAdapter {
  private readonly chunksById = new Map<string, IChunk>();

  /**
   * chunks -- every chunk of the index
   *
   * # About
   *
   * > In upsert order, without the vectors; a copy, not the stored object.
   */
  public get chunks(): IChunk[] {
    return [...this.chunksById.values()];
  }

  /**
   * upsert -- the parent's upsert, and the listing updated
   *
   * # About
   *
   * > A chunk with the same id replaces its copy in the listing.
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
    await super.upsert({
      tenantId,
      records,
    });
    records.forEach(({chunk}) => this.chunksById.set(chunk.id, structuredClone(chunk)));
  }

  /**
   * deleteByDoc -- the parent's delete, and the listing updated
   *
   * # About
   *
   * > The chunks of the document leave the listing; the count is the parent's.
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
    const deleted = await super.deleteByDoc({
      tenantId,
      docId,
    });
    [...this.chunksById.values()]
      .filter(chunk => chunk.docId === docId)
      .forEach(chunk => this.chunksById.delete(chunk.id));
    return deleted;
  }

  /**
   * moveBook -- the parent's move, and the listing updated
   *
   * # About
   *
   * > The listed chunks of the book get the new `libraryId`; the count is the parent's.
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
