import {
  IChunkFilters,
  IRetrievalResult,
  InMemoryModelRegistryRepository,
  InMemoryPromptTemplateRepository,
  InMemoryTraceRepository,
  InMemoryUsageAdapter,
  InMemoryVectorIndexAdapter,
  EModelProvider,
} from "../../..";
import {
  Embedder,
  KbIngestor,
  KbRetriever,
  LLMClient,
  MdChunker,
  ModelRegistry,
  PromptTemplateStore,
  QueryRewriter,
  Trace,
  UsageGuard,
  VectorStore,
} from "../../../internal";

import {kbEvalDocuments} from "./kbEvalDocuments";
import {
  IKbEvalQuestion,
  kbEvalNearMissQuestions,
  kbEvalOffTopicQuestions,
  kbEvalQuestions,
} from "./kbEvalQuestions";

// The eval of the knowledge-base search, with real embeddings: with invented vectors every search test passes.
// Runs only when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); otherwise it is skipped.
const openAiKey = process.env.AIGATEWAY_TEST_OPENAI_API_KEY || "";
const embeddingModel = process.env.AIGATEWAY_TEST_OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const DIMENSIONS = 1536;
const K = 5;
const REQUIRED_HIT_RATE = 0.8;

const describeWithOpenAi = openAiKey ? describe : describe.skip;

const everything: IChunkFilters = {
  libraryIds: "all",
  bookIds: [],
};

interface IEvalStack {
  ingestor: KbIngestor;
  retriever: KbRetriever;
}

/** The real KB stack on the real embedding model; only the index is in memory. */
const makeStack = async (): Promise<IEvalStack> => {
  const repository = new InMemoryModelRegistryRepository();
  await repository.save({
    model: {
      id: "embedding-model",
      provider: EModelProvider.OPENAI,
      providerModelId: embeddingModel,
      label: "Embedding model",
      caps: {
        tools: false,
        images: false,
        pdf: false,
        structuredOutput: false,
        reasoning: false,
        temperature: true,
        embeddings: true,
        contextTokens: 8_191,
        maxOutputTokens: 0,
        costInPerMTokUsd: 0.02,
        costOutPerMTokUsd: 0,
      },
      enabled: true,
      deprecatedAt: null,
    },
  });
  const modelRegistry = new ModelRegistry({repository});
  const llmClient = new LLMClient({providers: {[EModelProvider.OPENAI]: {apiKey: openAiKey}}}, {
    modelRegistry,
    usageGuard: new UsageGuard({adapter: new InMemoryUsageAdapter()}),
    trace: new Trace({repository: new InMemoryTraceRepository()}),
  });
  const embedder = new Embedder({
    embeddingModelId: "embedding-model",
    dimensions: DIMENSIONS,
  }, {llmClient});
  const vectorStore = new VectorStore({
    adapter: new InMemoryVectorIndexAdapter({
      embeddingModelId: "embedding-model",
      dimensions: DIMENSIONS,
    }),
  });
  return {
    ingestor: new KbIngestor({}, {
      // The sections of the eval documents are 70–110 tokens long. With the default minTokens (100) most of them would be
      // Merged into one chunk per document and there would be nothing to rank; 60 keeps one chunk per section.
      mdChunker: new MdChunker({minTokens: 60}),
      embedder,
      vectorStore,
    }),
    retriever: new KbRetriever({}, {
      queryRewriter: new QueryRewriter({enabled: false}, {
        llmClient,
        promptTemplateStore: new PromptTemplateStore({repository: new InMemoryPromptTemplateRepository()}),
      }),
      embedder,
      vectorStore,
    }),
  };
};

interface IMeasured {
  question: string;
  /** Position of the expected chunk among the hits, 0 = first; -1 = not among them. */
  rank: number;
  /** Score of the expected chunk; 0 when it was not among the hits. */
  score: number;
}

const isExpected = ({
  docId,
  phrase,
}: IKbEvalQuestion, result: IRetrievalResult, index: number): boolean =>
  result.hits[index].chunk.docId === docId && result.hits[index].chunk.text.includes(phrase);

describeWithOpenAi("KB eval — real embeddings", () => {
  let stack: IEvalStack;
  let chunkCount = 0;
  /** Every question searched with k = 5 and no threshold: where the expected chunk lands, and with which score. */
  const measured: IMeasured[] = [];
  /** The best score of each off-topic question, without a threshold. */
  const offTopicScores: number[] = [];
  /** The best score of each near-miss question (same shop, not in the handbook), without a threshold. */
  const nearMissScores: number[] = [];

  const retrieve = (prompt: string, minScore?: number): Promise<IRetrievalResult> =>
    stack.retriever.retrieve({
      tenantId: "tenant-a",
      prompt,
      facts: {},
      summary: "",
      cheapModelId: "unused",
      meta: {tenantId: "tenant-a"},
      filters: everything,
      k: K,
      minScore,
    });

  beforeAll(async () => {
    stack = await makeStack();
    for (const doc of kbEvalDocuments) {
      chunkCount += (await stack.ingestor.ingestDocument({
        tenantId: "tenant-a",
        doc,
      })).chunksWritten;
    }
    for (const question of kbEvalQuestions) {
      const result = await retrieve(question.question, 0);
      const rank = result.hits.findIndex((_hit, index) => isExpected(question, result, index));
      measured.push({
        question: question.question,
        rank,
        score: rank < 0 ? 0 : result.hits[rank].score,
      });
    }
    for (const question of kbEvalOffTopicQuestions) offTopicScores.push((await retrieve(question, 0)).hits[0]?.score ?? 0);
    for (const question of kbEvalNearMissQuestions) nearMissScores.push((await retrieve(question, 0)).hits[0]?.score ?? 0);

    const found = measured.filter(item => item.rank >= 0);
    const round = (value: number): number => Math.round(value * 1000) / 1000;
    console.info([
      `KB eval (${embeddingModel}, ${chunkCount} chunks, k = ${K}):`,
      `expected chunk first: ${measured.filter(item => item.rank === 0).length} / ${measured.length}`,
      `expected chunk in the top ${K}: ${found.length} / ${measured.length}`,
      `score of the expected chunk: lowest ${round(Math.min(...found.map(item => item.score)))}, highest ${round(Math.max(...found.map(item => item.score)))}`,
      `best score of an off-topic question: lowest ${round(Math.min(...offTopicScores))}, highest ${round(Math.max(...offTopicScores))}`,
      `best score of a near-miss question (same shop, not in the handbook): lowest ${round(Math.min(...nearMissScores))}, highest ${round(Math.max(...nearMissScores))}`,
      `missed: ${measured.filter(item => item.rank < 0).map(item => item.question)
        .join(" | ") || "none"}`,
    ].join("\n  "));
  }, 240_000);

  test("the documents give one chunk per section", () => {
    expect(chunkCount).toBe(30);
  });

  test("eval set: the expected chunk is in the top-k for ≥ 80 % of the 30 questions", () => {
    expect(measured.filter(item => item.rank >= 0).length / measured.length).toBeGreaterThanOrEqual(REQUIRED_HIT_RATE);
  });

  test("the expected chunk is the first hit for at least two thirds of the questions", () => {
    expect(measured.filter(item => item.rank === 0).length / measured.length).toBeGreaterThanOrEqual(2 / 3);
  });

  test("with the default threshold the expected chunk still passes for ≥ 80 % of the questions", async () => {
    let passed = 0;
    for (const question of kbEvalQuestions) {
      const result = await retrieve(question.question);
      if (result.hits.some((_hit, index) => isExpected(question, result, index))) passed++;
    }
    expect(passed / kbEvalQuestions.length).toBeGreaterThanOrEqual(REQUIRED_HIT_RATE);
  }, 120_000);

  test("with the default threshold an off-topic question finds nothing", async () => {
    const results = await Promise.all(kbEvalOffTopicQuestions.map(question => retrieve(question)));
    expect(results.map(result => result.noMatch)).toEqual(kbEvalOffTopicQuestions.map(() => true));
  }, 60_000);
});
