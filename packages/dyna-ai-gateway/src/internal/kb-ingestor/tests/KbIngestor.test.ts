import {InMemoryVectorIndexAdapter} from "../../../adapters/in-memory";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {Embedder} from "../../embedder";
import {
  IKbDocument,
  MdChunker,
} from "../../md-chunker";
import {ETraceKind} from "../../trace";
import {
  IChunkFilters,
  IChunkHit,
  VectorStore,
} from "../../vector-store";

import {KbIngestor} from "../KbIngestor";
import {
  IIngestReport,
  IKbIngestorConfig,
} from "../types";

const WORDS = ["refund", "invoice", "weather"];

/** A vector that counts three words: texts about the same thing point the same way. */
const toVector = (text: string): number[] => WORDS.map(word => text.toLowerCase().split(word).length - 1 + 0.01);

const everything: IChunkFilters = {
  libraryIds: "all",
  bookIds: [],
};

interface ISetup {
  ingestor: KbIngestor;
  llmClient: FakeLLMClient;
  vectorStore: VectorStore;
  search(text: string, tenantId?: string, filters?: IChunkFilters): Promise<IChunkHit[]>;
}

const setup = (config: IKbIngestorConfig = {}, indexModelId = "embedding-a"): ISetup => {
  const llmClient = new FakeLLMClient();
  llmClient.embedWith(toVector);
  const vectorStore = new VectorStore({
    adapter: new InMemoryVectorIndexAdapter({
      embeddingModelId: indexModelId,
      dimensions: 3,
    }),
  });
  return {
    llmClient,
    vectorStore,
    ingestor: new KbIngestor(config, {
      // Small chunks, so a test document of a few lines gives several
      mdChunker: new MdChunker({
        maxTokens: 30,
        minTokens: 0,
        overlapTokens: 0,
      }),
      embedder: new Embedder({
        embeddingModelId: "embedding-a",
        dimensions: 3,
      }, {llmClient}),
      vectorStore,
    }),
    search: (text, tenantId = "tenant-a", filters = everything): Promise<IChunkHit[]> =>
      vectorStore.search({
        tenantId,
        vector: toVector(text),
        k: 10,
        filters,
      }),
  };
};

const refundText = "A refund of a paid invoice is possible within 12 months.";

const makeDoc = (overrides: Partial<IKbDocument> = {}): IKbDocument => ({
  id: "doc-1",
  bookId: "book-1",
  libraryId: "tax",
  title: "Guide",
  markdown: `# Refunds\n${refundText}\n# Weather\nThe weather station reports the weather of Vienna.`,
  tags: [],
  language: "en",
  ...overrides,
});

const ingest = ({ingestor}: ISetup, doc: IKbDocument = makeDoc(), tenantId = "tenant-a"): Promise<IIngestReport> =>
  ingestor.ingestDocument({
    tenantId,
    doc,
    userId: "admin-a",
  });

describe("KbIngestor", () => {
  afterEach(() => jest.restoreAllMocks());

  describe("M5 — ingestDocument", () => {
    test("ingest → search returns the chunk for its own text with score ≈ 1", async () => {
      const context = setup();
      await ingest(context);
      const [best] = await context.search(`Guide > Refunds\n\n${refundText}`);
      expect([best.chunk.text, Math.round(best.score * 1000) / 1000]).toEqual([refundText, 1]);
    });

    test("the heading path is prefixed to the chunk text when it is embedded; the stored text stays as written", async () => {
      const context = setup();
      await ingest(context);
      const [best] = await context.search("refund invoice");
      expect([context.llmClient.embedCalls[0].texts[0], best.chunk.text]).toEqual([`Guide > Refunds\n\n${refundText}`, refundText]);
    });

    test("the report counts what was written and deleted, and the tokens that were embedded", async () => {
      const context = setup();
      const report = await ingest(context);
      expect([report.docId, report.chunksWritten, report.chunksDeleted, report.tokens > 0, report.durationMs >= 0]).toEqual(["doc-1", 2, 0, true, true]);
    });

    test("ingesting a document again replaces its chunks: nothing is doubled, what was removed from it is gone", async () => {
      const context = setup();
      await ingest(context);
      const report = await ingest(context, makeDoc({markdown: `# Refunds\n${refundText}`}));
      expect([report.chunksDeleted, report.chunksWritten, (await context.search("weather")).map(hit => hit.chunk.headingPath)]).toEqual([2, 1, ["Guide > Refunds"]]);
    });

    test("the chunks of another document stay", async () => {
      const context = setup();
      await ingest(context);
      await ingest(context, makeDoc({
        id: "doc-2",
        markdown: "# Invoices\nAn invoice has a number.",
      }));
      expect((await context.search("refund")).map(hit => hit.chunk.docId).sort()).toEqual(["doc-1", "doc-1", "doc-2"]);
    });

    test("the embed call carries the tenant, the admin and the kind EMBED", async () => {
      const context = setup();
      await ingest(context);
      expect(context.llmClient.embedCalls[0].meta).toEqual({
        tenantId: "tenant-a",
        userId: "admin-a",
        kind: ETraceKind.EMBED,
      });
    });

    test("the chunks are stored for the tenant of the call only", async () => {
      const context = setup();
      await ingest(context);
      expect(await context.search("refund", "tenant-b")).toEqual([]);
    });

    test("an empty document removes its old chunks and writes none", async () => {
      const context = setup();
      await ingest(context);
      const report = await ingest(context, makeDoc({markdown: ""}));
      expect([report.chunksDeleted, report.chunksWritten, await context.search("refund")]).toEqual([2, 0, []]);
    });

    test("when the embedding fails the old chunks stay in the index", async () => {
      const context = setup();
      await ingest(context);
      jest.spyOn(context.llmClient, "embed").mockRejectedValue(new Error("rate limited"));
      await ingest(context, makeDoc({markdown: "# New\nNew text."})).catch(() => undefined);
      expect((await context.search("refund")).length).toBe(2);
    });

    test("an Embedder of another model than the index is refused before any model call", async () => {
      const context = setup({}, "embedding-b");
      await expect(ingest(context)).rejects.toMatchObject({
        code: 5372774697006,
        status: 400,
      });
      expect(context.llmClient.embedCalls).toHaveLength(0);
    });
  });

  describe("M5 — removeDocument and moveBook", () => {
    test("removeDocument removes the document's chunks and returns their number", async () => {
      const context = setup();
      await ingest(context);
      const removed = await context.ingestor.removeDocument({
        tenantId: "tenant-a",
        docId: "doc-1",
      });
      expect([removed, await context.search("refund")]).toEqual([2, []]);
    });

    test("moveBook moves the book's chunks to the other library without a model call", async () => {
      const context = setup();
      await ingest(context);
      const callsBefore = context.llmClient.embedCalls.length;
      const moved = await context.ingestor.moveBook({
        tenantId: "tenant-a",
        bookId: "book-1",
        libraryId: "archive",
      });
      const inArchive = await context.search("refund", "tenant-a", {
        libraryIds: ["archive"],
        bookIds: [],
      });
      expect([moved, inArchive.length, context.llmClient.embedCalls.length - callsBefore]).toEqual([2, 2, 0]);
    });
  });

  describe("M5 — reindexBook", () => {
    const docs = ["doc-1", "doc-2", "doc-3"].map(id => makeDoc({id}));

    const reindex = (context: ISetup, onProgress?: (report: IIngestReport) => void): Promise<IIngestReport[]> =>
      context.ingestor.reindexBook({
        tenantId: "tenant-a",
        bookId: "book-1",
        docs,
        userId: "admin-a",
        onProgress,
      });

    test("ingests every document and returns one report per document, in the order of the documents", async () => {
      const context = setup();
      const reports = await reindex(context);
      expect([reports.map(report => report.docId), reports.map(report => report.chunksWritten)]).toEqual([["doc-1", "doc-2", "doc-3"], [2, 2, 2]]);
    });

    test("calls onProgress once per document", async () => {
      const context = setup();
      const seen: string[] = [];
      await reindex(context, report => seen.push(report.docId));
      expect(seen.sort()).toEqual(["doc-1", "doc-2", "doc-3"]);
    });

    test("never works on more documents at a time than config.concurrency", async () => {
      const context = setup({concurrency: 2});
      let running = 0;
      let most = 0;
      const embed = context.llmClient.embed.bind(context.llmClient);
      jest.spyOn(context.llmClient, "embed").mockImplementation(async args => {
        running++;
        most = Math.max(most, running);
        await new Promise(setImmediate);
        running--;
        return embed(args);
      });
      await reindex(context);
      expect(most).toBe(2);
    });

    test("a document that fails does not stop the book: its report carries the error and is reported with its code", async () => {
      const context = setup();
      const report = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const embed = context.llmClient.embed.bind(context.llmClient);
      jest.spyOn(context.llmClient, "embed").mockImplementation(async args => {
        if (args.texts[0].includes("Broken")) throw new Error("rate limited");
        return embed(args);
      });
      const reports = await context.ingestor.reindexBook({
        tenantId: "tenant-a",
        bookId: "book-1",
        docs: [docs[0], makeDoc({
          id: "doc-2",
          title: "Broken",
        }), docs[2]],
      });
      expect([
        reports.map(item => [item.docId, item.chunksWritten, item.error]),
        String(report.mock.calls[0][0]).startsWith("Internal error 5372774696808: "),
      ]).toEqual([[["doc-1", 2, undefined], ["doc-2", 0, "rate limited"], ["doc-3", 2, undefined]], true]);
    });

    test("a document of another book is a 400 and nothing is ingested", async () => {
      const context = setup();
      await expect(context.ingestor.reindexBook({
        tenantId: "tenant-a",
        bookId: "book-1",
        docs: [docs[0], makeDoc({
          id: "doc-9",
          bookId: "book-9",
        })],
      })).rejects.toMatchObject({
        code: 5372774696616,
        status: 400,
      });
      expect(context.llmClient.embedCalls).toHaveLength(0);
    });

    test("a book without documents gives no reports", async () => {
      expect(await setup().ingestor.reindexBook({
        tenantId: "tenant-a",
        bookId: "book-1",
        docs: [],
      })).toEqual([]);
    });
  });
});
