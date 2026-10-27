import {
  InMemoryPromptTemplateRepository,
  InMemoryVectorIndexAdapter,
} from "../../../adapters/in-memory";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {Embedder} from "../../embedder";
import {EFinishReason} from "../../llm-client";
import {PromptTemplateStore} from "../../prompt-template-store";
import {QueryRewriter} from "../../query-rewriter";
import {ETraceKind} from "../../trace";
import {
  IChunkFilters,
  IChunkRecord,
  VectorStore,
} from "../../vector-store";

import {KbRetriever} from "../KbRetriever";
import {
  IKbRetrieverConfig,
  IRetrievalResult,
} from "../types";

const WORDS = ["refund", "invoice", "weather"];

/** A vector that counts three words: texts about the same thing point the same way. */
const toVector = (text: string): number[] => WORDS.map(word => text.toLowerCase().split(word).length - 1 + 0.01);

const makeRecord = (id: string, text: string, libraryId = "tax", tenantId = "tenant-a"): IChunkRecord => ({
  tenantId,
  chunk: {
    id,
    docId: "doc-1",
    bookId: "book-1",
    libraryId,
    headingPath: "Guide",
    text,
    order: 0,
    tokens: 10,
    tags: [],
    language: "en",
  },
  vector: toVector(text),
  embeddingModelId: "embedding-a",
});

interface ISetup {
  retriever: KbRetriever;
  llmClient: FakeLLMClient;
}

/** An index with a refund chunk and an invoice chunk in "tax", a weather chunk in "weather", and a refund chunk of tenant-b. */
const setup = async (config: IKbRetrieverConfig = {}, rewriterEnabled = false): Promise<ISetup> => {
  const llmClient = new FakeLLMClient();
  llmClient.embedWith(toVector);
  const vectorStore = new VectorStore({
    adapter: new InMemoryVectorIndexAdapter({
      embeddingModelId: "embedding-a",
      dimensions: 3,
    }),
  });
  await vectorStore.upsertChunks({
    tenantId: "tenant-a",
    records: [
      makeRecord("refund-chunk", "A refund is possible within 12 months."),
      makeRecord("invoice-chunk", "An invoice has a number and a refund note; invoice, invoice."),
      makeRecord("weather-chunk", "The weather of Vienna.", "weather"),
    ],
  });
  await vectorStore.upsertChunks({
    tenantId: "tenant-b",
    records: [makeRecord("refund-of-b", "A refund of tenant b.", "tax", "tenant-b")],
  });
  return {
    llmClient,
    retriever: new KbRetriever(config, {
      queryRewriter: new QueryRewriter({enabled: rewriterEnabled}, {
        llmClient,
        promptTemplateStore: new PromptTemplateStore({repository: new InMemoryPromptTemplateRepository()}),
      }),
      embedder: new Embedder({
        embeddingModelId: "embedding-a",
        dimensions: 3,
      }, {llmClient}),
      vectorStore,
    }),
  };
};

const everything: IChunkFilters = {
  libraryIds: "all",
  bookIds: [],
};

const retrieve = (
  {retriever}: ISetup,
  prompt: string,
  overrides: Partial<Parameters<KbRetriever["retrieve"]>[0]> = {},
): Promise<IRetrievalResult> =>
  retriever.retrieve({
    tenantId: "tenant-a",
    prompt,
    facts: {},
    summary: "",
    cheapModelId: "cheap-model",
    meta: {
      tenantId: "tenant-a",
      userId: "user-a",
      threadId: "thread-1",
    },
    filters: everything,
    ...overrides,
  });

const getIds = (result: IRetrievalResult): string[] => result.hits.map(hit => hit.chunk.id);

describe("KbRetriever", () => {
  describe("M5 — retrieve", () => {
    test("returns the chunks that are about the prompt, best first", async () => {
      const result = await retrieve(await setup({minScore: 0.75}), "refund");
      expect([getIds(result), result.noMatch, result.searched, result.query]).toEqual([["refund-chunk"], false, true, "refund"]);
    });

    test("returns noMatch when every hit is below the threshold", async () => {
      const result = await retrieve(await setup({minScore: 0.999}), "refund invoice weather");
      expect([result.hits, result.noMatch, result.searched]).toEqual([[], true, true]);
    });

    test("minScore of the call overrides the config: a lower threshold lets weaker hits in", async () => {
      const result = await retrieve(await setup(), "refund", {minScore: 0});
      expect(getIds(result)).toEqual(["refund-chunk", "invoice-chunk", "weather-chunk"]);
    });

    test("k limits the hits, the config's and the call's", async () => {
      const context = await setup({
        k: 2,
        minScore: 0,
      });
      expect([getIds(await retrieve(context, "refund")).length, getIds(await retrieve(context, "refund", {k: 1})).length]).toEqual([2, 1]);
    });

    test("searches only the libraries of the filters", async () => {
      const result = await retrieve(await setup(), "weather", {
        filters: {
          libraryIds: ["tax"],
          bookIds: [],
        },
        minScore: 0.9,
      });
      expect(getIds(result)).toEqual([]);
    });

    test("never returns the chunks of another tenant", async () => {
      const result = await retrieve(await setup(), "refund", {minScore: 0});
      expect(getIds(result).includes("refund-of-b")).toBe(false);
    });

    test("an empty libraryIds does not use the knowledge base: no model call, searched is false", async () => {
      const context = await setup();
      const result = await retrieve(context, "refund", {
        filters: {
          libraryIds: [],
          bookIds: [],
        },
      });
      expect([result, context.llmClient.embedCalls.length]).toEqual([
        {
          query: "refund",
          hits: [],
          noMatch: true,
          searched: false,
        },
        0,
      ]);
    });

    test("the embedding call carries who asks and the kind EMBED", async () => {
      const context = await setup();
      await retrieve(context, "refund");
      expect(context.llmClient.embedCalls[0].meta).toEqual({
        tenantId: "tenant-a",
        userId: "user-a",
        threadId: "thread-1",
        kind: ETraceKind.EMBED,
      });
    });
  });

  describe("M5 — retrieve with the rewriter switched on", () => {
    const withMemory = {
      summary: "The user asks about refunds.",
      facts: {topic: "refund"},
    };

    test("embeds the rewritten query, and reports it", async () => {
      const context = await setup({minScore: 0.75}, true);
      context.llmClient.enqueueComplete({
        modelId: "cheap-model",
        text: "refund time limit",
        toolCalls: [],
        finishReason: EFinishReason.STOP,
        usage: {
          inputTokens: 10,
          outputTokens: 2,
        },
        latencyMs: 1,
        traceId: "trace-1",
      }, ETraceKind.QUERY_REWRITE);
      const result = await retrieve(context, "and for last year's?", withMemory);
      expect([result.query, context.llmClient.embedCalls[0].texts, getIds(result)]).toEqual(["refund time limit", ["refund time limit"], ["refund-chunk"]]);
    });

    test("the rewrite call carries the kind QUERY_REWRITE and the cheap model", async () => {
      const context = await setup({}, true);
      context.llmClient.enqueueComplete({
        modelId: "cheap-model",
        text: "refund",
        toolCalls: [],
        finishReason: EFinishReason.STOP,
        usage: {
          inputTokens: 10,
          outputTokens: 2,
        },
        latencyMs: 1,
        traceId: "trace-1",
      }, ETraceKind.QUERY_REWRITE);
      await retrieve(context, "and for last year's?", withMemory);
      const [call] = context.llmClient.completeCalls;
      expect([call.meta.kind, call.request.modelId]).toEqual([ETraceKind.QUERY_REWRITE, "cheap-model"]);
    });
  });
});
