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

/**
 * KbIngestor -- the write side of the knowledge base: Markdown to chunks to vectors to index
 *
 * # About
 *
 * > Save a document in the editor; the knowledge base knows it.
 *
 * Implements `IKbIngestor`, the gateway's second root (`AIGateway.kbIngestor`), used by the application's knowledge-base
 * write endpoints and never during a prompt:
 *
 * - `ingestDocument`: chunk (`MdChunker`) → embed heading path + text (`Embedder`) → delete the document's old chunks →
 *   store the new ones (`VectorStore`). Idempotent per document: a re-save replaces that document's chunks only.
 * - `removeDocument`, `moveBook`: pass through to the index; a moved book is not embedded again (D22).
 * - `reindexBook`: `ingestDocument` for every document of a book, `concurrency` at a time, one report each; needed
 *   when the embedding model changes.
 *
 * Before any model call it checks that the `Embedder` and the index use the same embedding model and vector length.
 *
 * # Who needs it
 *
 * The application, through `AIGateway.kbIngestor`, from its document save, delete and move endpoints. A host replaces
 * it with its own `IKbIngestor` in `overrides.kbIngestor`.
 *
 * # What needs
 *
 * `mdChunker`, `embedder`, `vectorStore`.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, through the gateway: `createGatewayDeps` creates it from `IAIGatewayConfig.kbIngestor` (optional, all
 * defaults).
 *
 * ## When shouldn't use it
 *
 * Not from inside a call or a tool: the ingestion is an admin operation with its own usage-guard checks (kind EMBED),
 * not part of the user's turn.
 *
 * # Pitfalls
 *
 * The usage adapter may refuse the embedding (a 429 with `code` `USAGE_DENIED_ERROR_CODE`): `ingestDocument` throws
 * it before anything is written, `reindexBook` stops the book at it. A failed embedding leaves the index as it was: the
 * delete comes after the embedding.
 */
export class KbIngestor implements IKbIngestor {
  constructor(
    private readonly config: IKbIngestorConfig,
    private readonly deps: IKbIngestorDeps,
  ) {}

  /**
   * ingestDocument -- replaces a document's chunks in the index
   *
   * # About
   *
   * > Chunk, embed, then swap the old chunks for the new ones.
   *
   * Chunks the document, embeds heading path + text of every chunk, deletes the document's old chunks and stores the
   * new ones with the `Embedder`'s model id. The delete comes after the embedding, so a failed embedding leaves the
   * index as it was. Returns the counts, the estimated tokens embedded and the duration.
   *
   * Throws a 400 before any model call when the `Embedder` and the index do not use the same embedding model and
   * dimensions (error 5372774697006), and the usage adapter's refusal of the embedding (a 429 whose `code` is
   * `USAGE_DENIED_ERROR_CODE`, `data.denyCode` the app's code) before anything is written.
   *
   * # Who needs it
   *
   * The application's document save endpoint, through `AIGateway.kbIngestor`; `reindexBook`, per document.
   *
   * # Pitfalls
   *
   * Between the delete and the upsert the document is briefly absent from the index: a search in that window misses
   * it. One document is one `embed` call per `batchSize` chunks, each checked by the usage adapter.
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

  /**
   * removeDocument -- removes a document from the index
   *
   * # About
   *
   * > The document was deleted in the editor; its chunks go.
   *
   * `VectorStore.deleteByDoc`; returns the number of chunks removed, 0 for a document that is not in the index.
   *
   * # Who needs it
   *
   * The application's document delete endpoint, through `AIGateway.kbIngestor`.
   */
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

  /**
   * moveBook -- moves a book to another library
   *
   * # About
   *
   * > A new shelf, the same vectors (D22).
   *
   * `VectorStore.moveBook`: changes the `libraryId` of the book's chunks, no embedding. Returns the number of chunks
   * changed; 0 for a book that is not in the index.
   *
   * # Who needs it
   *
   * The application's book move endpoint, through `AIGateway.kbIngestor`.
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
    return this.deps.vectorStore.moveBook({
      tenantId,
      bookId,
      libraryId,
    });
  }

  /**
   * reindexBook -- re-ingests every document of a book
   *
   * # About
   *
   * > The embedding model changed, or the book is in doubt: build it again, document by document.
   *
   * `ingestDocument` for every document of `docs`, `concurrency` at a time; one report per document, in the order of
   * `docs`, each also given to `onProgress` as it completes. A document that fails does not stop the book: its report
   * carries the error (logged as 5372774696808) and its old chunks stay in the index.
   *
   * Throws a 400 before anything is ingested when a document is not of the book (error 5372774696616), and the usage
   * adapter's refusal (429) as `ingestDocument` does: the documents ingested before it are in the index, the rest are
   * not.
   *
   * # Who needs it
   *
   * The application's reindex endpoint or job, through `AIGateway.kbIngestor`, after a change of the embedding model
   * or of the chunker settings.
   *
   * # Pitfalls
   *
   * The caller supplies `docs`: the gateway does not know which documents a book holds. A book with documents missing
   * from `docs` keeps their old chunks, embedded with the old ruler, and `upsertChunks` refuses nothing about them.
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

  /** The Embedder and the index must use the same ruler: embedding model and vector length. */
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
