import {
  IChunk,
  IChunkFilters,
  IAIGatewayConfig,
  IKbDocument,
  TGatewayResponse,
  InMemoryUserMemoryRepository,
  EGatewayResponseKind,
  EResumeAction,
  ETraceKind,
} from "../..";

import {
  IGatewaySetup,
  makeGateway,
  makeModelResult,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";
import {
  makeCall,
  makeToolGateway,
} from "../internal/utils/makeToolGateway";

const WORDS = ["refund", "invoice", "weather"];

/** The fake embedding: a vector that counts three words, so texts about the same thing point the same way. */
const toVector = (text: string): number[] => WORDS.map(word => text.toLowerCase().split(word).length - 1 + 0.01);

const refundText = "A refund is possible within 12 months.";

const makeDoc = (overrides: Partial<IKbDocument> = {}): IKbDocument => ({
  id: "refund-doc",
  bookId: "tax-book",
  libraryId: "tax",
  title: "Refunds",
  markdown: refundText,
  tags: [],
  language: "en",
  ...overrides,
});

const weatherDoc = makeDoc({
  id: "weather-doc",
  bookId: "weather-book",
  libraryId: "weather",
  title: "Weather",
  markdown: "The weather of Vienna: light rain.",
});

const inLibraries = (...libraryIds: string[]): IChunkFilters => ({
  libraryIds,
  bookIds: [],
});

/** A gateway whose tenant-a has a refund document in the library "tax" and a weather document in "weather". */
const setupKb = async (configOverrides: Partial<IAIGatewayConfig> = {}, withTools = false): Promise<IGatewaySetup> => {
  const setup = withTools ? await makeToolGateway(configOverrides) : await makeGateway(configOverrides);
  setup.llmClient.embedWith(toVector);
  for (const doc of [makeDoc(), weatherDoc]) {
    await setup.gateway.kbIngestor.ingestDocument({
      tenantId: "tenant-a",
      doc,
    });
  }
  return setup;
};

const ask = async (setup: IGatewaySetup, prompt: string, kbFilters: IChunkFilters): Promise<TGatewayResponse> => {
  setup.llmClient.enqueueComplete(makeModelResult());
  return setup.gateway.ask({
    profileId: "default",
    userContext,
    prompt,
    kbFilters,
  }).response;
};

/** An output rule that records the chunks of its evidence; it always passes. */
const recordChunks = (seen: IChunk[][]): Partial<IAIGatewayConfig> => ({
  guardrails: {
    outputRules: [
      {
        name: "record_chunks",
        check: async ({evidence}) => {
          seen.push(evidence.chunks);
          return [];
        },
      },
    ],
  },
});

const getSystem = ({llmClient}: IGatewaySetup): string => llmClient.completeCalls.filter(call => call.meta.kind === ETraceKind.CHAT).at(-1)?.request.system ?? "";

/** The embedding calls of questions: the two ingestions of setupKb come first. */
const getSearchCalls = ({llmClient}: IGatewaySetup): typeof llmClient.embedCalls => llmClient.embedCalls.slice(2);

describe("AIGateway — M5: knowledge base", () => {
  afterEach(() => jest.restoreAllMocks());

  describe("ask", () => {
    test("a question finds its chunk: the chunk is in the system prompt and the answer cites it", async () => {
      const setup = await setupKb();
      const response = await ask(setup, "Can I get a refund?", inLibraries("tax"));
      expect([getSystem(setup).includes(`[refund-doc#0] Refunds\n${refundText}`), response.kind === EGatewayResponseKind.ANSWER && response.citations])
        .toEqual([true, ["refund-doc#0"]]);
    });

    test("a call without a library (noKb) makes no embedding call, has no citations and no knowledge base in its prompt", async () => {
      const setup = await setupKb();
      const response = await ask(setup, "Can I get a refund?", noKb);
      expect([getSearchCalls(setup).length, response.kind === EGatewayResponseKind.ANSWER && response.citations, getSystem(setup).includes("Knowledge base")])
        .toEqual([0, [], false]);
    });

    test("searched without a match: the prompt tells the model so, and the answer has no citations", async () => {
      const setup = await setupKb();
      // The tax library has nothing about the weather
      const response = await ask(setup, "What is the weather?", inLibraries("tax"));
      expect([getSystem(setup).includes("it was searched and has nothing on this question"), response.kind === EGatewayResponseKind.ANSWER && response.citations])
        .toEqual([true, []]);
    });

    test("only the libraries of the call are searched", async () => {
      const setup = await setupKb();
      const response = await ask(setup, "What is the weather?", inLibraries("tax"));
      expect([response.kind === EGatewayResponseKind.ANSWER && response.citations, getSystem(setup).includes("light rain")]).toEqual([[], false]);
    });

    test("libraryIds \"all\" searches every library of the tenant", async () => {
      const setup = await setupKb();
      const response = await ask(setup, "What is the weather?", {
        libraryIds: "all",
        bookIds: [],
      });
      expect(response.kind === EGatewayResponseKind.ANSWER && response.citations).toEqual(["weather-doc#0"]);
    });

    test("bookIds narrows the search inside the libraries", async () => {
      const setup = await setupKb();
      const response = await ask(setup, "Can I get a refund?", {
        libraryIds: ["tax"],
        bookIds: ["another-book"],
      });
      expect(response.kind === EGatewayResponseKind.ANSWER && response.citations).toEqual([]);
    });

    test("the chunks of another tenant are never found", async () => {
      const setup = await setupKb();
      await setup.gateway.kbIngestor.ingestDocument({
        tenantId: "tenant-b",
        doc: makeDoc({
          id: "refund-of-b",
          markdown: "A refund of tenant b: refund, refund.",
        }),
      });
      const response = await ask(setup, "Can I get a refund?", {
        libraryIds: "all",
        bookIds: [],
      });
      expect(response.kind === EGatewayResponseKind.ANSWER && response.citations).toEqual(["refund-doc#0"]);
    });

    test("the embedding call of the search carries the tenant, the user, the thread and the kind EMBED", async () => {
      const setup = await setupKb();
      const response = await ask(setup, "Can I get a refund?", inLibraries("tax"));
      const [call] = getSearchCalls(setup);
      expect([call.texts, call.meta]).toEqual([
        ["Can I get a refund?"],
        {
          tenantId: "tenant-a",
          userId: "user-a",
          profileId: "default",
          threadId: response.threadId,
          kind: ETraceKind.EMBED,
        },
      ]);
    });

    test("the output rules get the chunks that were in the request", async () => {
      const seen: IChunk[][] = [];
      const setup = await setupKb(recordChunks(seen));
      await ask(setup, "Can I get a refund?", inLibraries("tax"));
      expect(seen.map(chunks => chunks.map(chunk => [chunk.id, chunk.text]))).toEqual([[["refund-doc#0", refundText]]]);
    });

    test("the trace entry of the answer has the ids of the chunks it was given", async () => {
      const setup = await setupKb();
      const response = await ask(setup, "Can I get a refund?", inLibraries("tax"));
      const entries = await setup.gateway.trace.query({
        tenantId: "tenant-a",
        filters: {
          threadId: response.threadId,
          kind: ETraceKind.CHAT,
        },
        skip: 0,
        limit: 10,
      });
      expect(entries.map(entry => entry.chunkIds)).toEqual([["refund-doc#0"]]);
    });

    test("a search that fails fails the call: the question is not answered without its knowledge base", async () => {
      const setup = await setupKb();
      jest.spyOn(setup.llmClient, "embed").mockRejectedValue(new Error("the embedding provider is down"));
      setup.llmClient.enqueueComplete(makeModelResult());
      await expect(setup.gateway.ask({
        profileId: "default",
        userContext,
        prompt: "Can I get a refund?",
        kbFilters: inLibraries("tax"),
      }).response).rejects.toThrow("the embedding provider is down");
      expect(setup.llmClient.completeCalls).toHaveLength(0);
    });
  });

  describe("the rewriter", () => {
    test("with memory and the rewriter switched on, the search uses the rewritten query", async () => {
      const setup = await setupKb({
        workingMemory: {enabled: true},
        userMemoryStore: {
          repository: new InMemoryUserMemoryRepository(),
          enabled: false,
        },
        queryRewriter: {enabled: true},
      });
      setup.llmClient.enqueueComplete(makeModelResult({
        structured: {
          summary: "The user asks about refunds of paid invoices.",
          facts: [],
        },
      }), ETraceKind.MEMORY_WORKING);
      const first = await ask(setup, "Can I get a refund?", inLibraries("tax"));
      await setup.gateway.whenIdle();

      setup.llmClient.enqueueComplete(makeModelResult({text: "refund time limit last year"}), ETraceKind.QUERY_REWRITE);
      setup.llmClient.enqueueComplete(makeModelResult({
        structured: {
          summary: "The user asks about refunds of paid invoices, also for last year.",
          facts: [],
        },
      }), ETraceKind.MEMORY_WORKING);
      setup.llmClient.enqueueComplete(makeModelResult());
      const second = await setup.gateway.ask({
        profileId: "default",
        userContext,
        threadId: first.threadId,
        prompt: "and for last year's?",
        kbFilters: inLibraries("tax"),
      }).response;
      await setup.gateway.whenIdle();
      expect([getSearchCalls(setup).at(-1)?.texts, second.kind === EGatewayResponseKind.ANSWER && second.citations])
        .toEqual([["refund time limit last year"], ["refund-doc#0"]]);
    });
  });

  describe("run and resume", () => {
    const run = (setup: IGatewaySetup, kbFilters: IChunkFilters): Promise<TGatewayResponse> =>
      setup.gateway.run({
        profileId: "default",
        userContext,
        prompt: "Can I get a refund for invoice 4521?",
        kbFilters,
      }).response;

    test("a run searches the knowledge base once, at its start, and its answer cites the chunks", async () => {
      const setup = await setupKb({}, true);
      setup.llmClient.enqueueRunStep({toolCall: makeCall("get_invoice")});
      setup.llmClient.enqueueRunStep({text: "Yes, within 12 months."});
      const response = await run(setup, inLibraries("tax"));
      expect([
        response.kind === EGatewayResponseKind.ANSWER && response.citations,
        getSearchCalls(setup).length,
        setup.llmClient.runCalls[0].request.system.includes(refundText),
      ]).toEqual([["refund-doc#0"], 1, true]);
    });

    test("the output rules of a run get the chunks that were in the request", async () => {
      const seen: IChunk[][] = [];
      const setup = await setupKb(recordChunks(seen), true);
      setup.llmClient.enqueueRunStep({text: "Yes, within 12 months."});
      await run(setup, inLibraries("tax"));
      expect(seen.map(chunks => chunks.map(chunk => chunk.id))).toEqual([["refund-doc#0"]]);
    });

    test("the answer of a resumed run cites the chunks of its first step (D36)", async () => {
      const setup = await setupKb({}, true);
      setup.llmClient.enqueueRunStep({toolCall: makeCall("refund")});
      const paused = await run(setup, inLibraries("tax"));
      setup.llmClient.enqueueRunStep({text: "Refunded."});
      const response = await setup.gateway.resume({
        userContext,
        runId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].runId : "",
        pauseId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].pauseId : "",
        decisions: [{action: EResumeAction.APPROVE}],
      }).response;
      expect([
        response.kind === EGatewayResponseKind.ANSWER && response.citations,
        setup.llmClient.runCalls[1].request.system.includes(refundText),
      ]).toEqual([["refund-doc#0"], true]);
    });
  });
});
