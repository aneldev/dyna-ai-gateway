import {dynaError} from "dyna-error";

import {IChunkRecord} from "../vector-store";
import {IKbDocument} from "../md-chunker";
import {ETraceKind} from "../trace";
import {isUsageDeniedError} from "../usage-guard";

import {
  IIngestReport,
  IKbIngestor,
  IKbIngestorConfig,
  IKbIngestorDeps,
} from "./types";

const DEFAULT_CONCURRENCY = 2;

/** KB write path: MD → chunks → vectors → index. */
export class KbIngestor implements IKbIngestor {
  constructor(
    private readonly config: IKbIngestorConfig,
    private readonly deps: IKbIngestorDeps,
  ) {}

  /**
   * Replaces a document's chunks in the index: chunk → embed (heading path + text) → delete the old chunks → store the new ones.
   * The old chunks are only deleted after the new ones were embedded, so a failed embedding leaves the index as it was.
   * Throws a 400 before any model call when the Embedder and the index do not use the same embedding model and dimensions, and
   * the usage adapter's refusal of the embedding (a 429 whose `code` is `USAGE_DENIED_ERROR_CODE`, `data.denyCode` the app's code)
   * before anything is written.
   */
  public async ingestDocument(
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
  ): Promise<IIngestReport> {
    const startedAt = Date.now();
    await this.checkIndex();

    const chunks = this.deps.mdChunker.chunk({doc});
    // The heading path is embedded with the text: a paragraph often only makes sense under its headings
    const texts = chunks.map(chunk => `${chunk.headingPath}\n\n${chunk.text}`);
    const vectors = await this.deps.embedder.embed({
      texts,
      meta: {
        tenantId,
        userId,
        kind: ETraceKind.EMBED,
      },
    });

    const chunksDeleted = await this.deps.vectorStore.deleteByDoc({
      tenantId,
      docId: doc.id,
    });
    await this.deps.vectorStore.upsertChunks({
      tenantId,
      records: chunks.map((chunk, index): IChunkRecord => ({
        tenantId,
        chunk,
        vector: vectors[index],
        embeddingModelId: this.deps.embedder.embeddingModelId,
      })),
    });

    return {
      docId: doc.id,
      chunksWritten: chunks.length,
      chunksDeleted,
      tokens: texts.reduce((sum, text) => sum + this.deps.mdChunker.countTokens({text}), 0),
      durationMs: Date.now() - startedAt,
    };
  }

  /** Removes a document from the index. Returns the number of chunks removed. */
  public async removeDocument(
    {
      tenantId,
      docId,
    }: {
      tenantId: string;
      docId: string;
    },
  ): Promise<number> {
    return this.deps.vectorStore.deleteByDoc({
      tenantId,
      docId,
    });
  }

  /** Moves a book to another library without embedding it again. Returns the number of chunks changed; 0 for a book that is not in the index. */
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
    return this.deps.vectorStore.moveBook({
      tenantId,
      bookId,
      libraryId,
    });
  }

  /**
   * Re-ingests every document of a book (e.g. after an embedding model change), config.concurrency documents at a time.
   * A document that fails does not stop the book: its report carries the error, and its old chunks stay in the index.
   * Returns one report per document, in the order of `docs`. Throws a 400, before anything is ingested, when a document is not of the book,
   * and the usage adapter's refusal (429) as `ingestDocument` does: the documents ingested before it are in the index, the rest are not.
   */
  public async reindexBook(
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
  ): Promise<IIngestReport[]> {
    const foreign = docs.find(doc => doc.bookId !== bookId);
    if (foreign) {
      throw dynaError({
        code: 5372774696616,
        status: 400,
        message: `KbIngestor: document [${foreign.id}] belongs to book [${foreign.bookId}], not to [${bookId}]`,
        data: {
          bookId,
          docId: foreign.id,
        },
      });
    }

    const reports: IIngestReport[] = [];
    let next = 0;
    const work = async (): Promise<void> => {
      while (next < docs.length) {
        const index = next++;
        const report = await this.ingestSafely({
          tenantId,
          doc: docs[index],
          userId,
        });
        reports[index] = report;
        onProgress?.(report);
      }
    };
    const workers = Math.max(1, Math.min(this.config.concurrency ?? DEFAULT_CONCURRENCY, docs.length));
    await Promise.all(Array.from({length: workers}, work));
    return reports;
  }

  /** IngestDocument that reports a failure instead of throwing it. */
  private async ingestSafely(
    {
      tenantId,
      doc,
      userId,
    }: {
      tenantId: string;
      doc: IKbDocument;
      userId?: string;
    },
  ): Promise<IIngestReport> {
    const startedAt = Date.now();
    try {
      return await this.ingestDocument({
        tenantId,
        doc,
        userId,
      });
    }
    catch (error) {
      // The app refused the embedding: the next documents would be refused too, the book stops here
      if (isUsageDeniedError(error)) throw error;
      console.error(`Internal error 5372774696808: KbIngestor: document [${doc.id}] of book [${doc.bookId}] was not ingested`, error);
      return {
        docId: doc.id,
        chunksWritten: 0,
        chunksDeleted: 0,
        tokens: 0,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** The Embedder and the index must use the same ruler: the same embedding model and the same vector length. */
  private async checkIndex(): Promise<void> {
    const index = await this.deps.vectorStore.describeIndex();
    const {
      embeddingModelId,
      dimensions,
    } = this.deps.embedder;
    if (index.embeddingModelId === embeddingModelId && index.dimensions === dimensions) return;
    throw dynaError({
      code: 5372774697006,
      status: 400,
      message:
        `KbIngestor: the Embedder uses model [${embeddingModelId}] with ${dimensions} dimensions, ` +
        `the index was created for model [${index.embeddingModelId}] with ${index.dimensions} dimensions`,
      data: {
        index,
        embedder: {
          embeddingModelId,
          dimensions,
        },
      },
    });
  }
}
