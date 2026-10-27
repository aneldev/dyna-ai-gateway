import {z} from "zod";

import {
  IAIGatewayConfig,
  AIGateway,
  InMemoryThreadRepository,
  InMemoryUserMemoryRepository,
  InMemoryVectorIndexAdapter,
  EGatewayResponseKind,
  EModelProvider,
  EResumeAction,
  ETraceKind,
  defineTool,
  EToolCallVerdict,
} from "../../index";

import {
  makeProfile,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";
import {makeGatewayConfig} from "../internal/utils/makeGatewayConfig";
import {sumMatchesTotal} from "../internal/utils/sumMatchesTotal";

// The M1 exit: ask() on a real model, with a structured answer that is schema-checked and validated.
// Runs only when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); otherwise it is skipped.
const openAiKey = process.env.AIGATEWAY_TEST_OPENAI_API_KEY || "";
const openAiModel = process.env.AIGATEWAY_TEST_OPENAI_MODEL || "gpt-5-mini";
const openAiEmbeddingModel = process.env.AIGATEWAY_TEST_OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

const describeWithOpenAi = openAiKey ? describe : describe.skip;

const invoiceSchema = z.object({
  total: z.number(),
  lines: z.array(z.object({
    description: z.string(),
    amount: z.number(),
  })),
});

/** Invoice ids the refund tool was executed for. */
const refunded: string[] = [];

const refundTool = defineTool({
  name: "refund",
  description: "Refunds an invoice by its number. Call it when the user asks to refund an invoice.",
  inputSchema: z.object({invoiceId: z.string()}),
  tags: [],
  policy: EToolCallVerdict.NEEDS_APPROVAL,
  execute: async ({input}): Promise<{refunded: boolean}> => {
    refunded.push(input.invoiceId);
    return {refunded: true};
  },
});

const makeRealGateway = async (configOverrides: Partial<IAIGatewayConfig> = {}): Promise<AIGateway> => {
  const gateway = new AIGateway({
    ...makeGatewayConfig(),
    llmClient: {providers: {[EModelProvider.OPENAI]: {apiKey: openAiKey}}},
    guardrails: {outputRules: [sumMatchesTotal]},
    toolRegistry: {tools: [refundTool]},
    ...configOverrides,
  });
  await gateway.modelRegistry.upsertModel({
    model: {
      id: "model-a",
      provider: EModelProvider.OPENAI,
      providerModelId: openAiModel,
      label: "Real model",
      caps: {
        tools: true,
        images: false,
        pdf: false,
        structuredOutput: true,
        reasoning: false,
        temperature: true,
        embeddings: false,
        contextTokens: 128_000,
        maxOutputTokens: 4_000,
        costInPerMTokUsd: 1,
        costOutPerMTokUsd: 2,
      },
      enabled: true,
      deprecatedAt: null,
    },
  });
  // The embedding model of the knowledge-base tests
  await gateway.modelRegistry.upsertModel({
    model: {
      id: "embedding-a",
      provider: EModelProvider.OPENAI,
      providerModelId: openAiEmbeddingModel,
      label: "Real embedding model",
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
  await gateway.aiProfileStore.upsertProfile({
    tenantId: "tenant-a",
    profile: makeProfile("default", {
      promptAddendum: "You read invoices for an accounting team.",
      allowedTools: ["refund"],
      limits: {
        maxStepsPerRun: 5,
        maxOutputTokens: 2_000,
      },
    }),
  });
  return gateway;
};

describeWithOpenAi("AIGateway — M1 exit, real provider", () => {
  test("ask returns a validated structured answer from a real model", async () => {
    const gateway = await makeRealGateway();
    const response = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "Invoice 4521 has two lines: 'Hosting' 10.00 and 'Support' 20.00. Return the lines and the total.",
      kbFilters: noKb,
      outputSchema: invoiceSchema,
    }).response;
    expect(response).toMatchObject({
      kind: EGatewayResponseKind.ANSWER,
      structured: {total: 30},
    });
  });

  test("ask answers in plain text and keeps the conversation in the thread", async () => {
    const gateway = await makeRealGateway();
    const first = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "My invoice number is 4521. Remember it.",
      kbFilters: noKb,
    }).response;
    const second = await gateway.ask({
      profileId: "default",
      userContext,
      threadId: first.threadId,
      prompt: "What is my invoice number? Answer with the number only.",
      kbFilters: noKb,
    }).response;
    expect(second.kind === EGatewayResponseKind.ANSWER ? second.text : "").toContain("4521");
  });
});

describeWithOpenAi("AIGateway — M2 exit, real provider", () => {
  test("run pauses on the refund tool and, after APPROVE, executes it and answers", async () => {
    const gateway = await makeRealGateway();
    const paused = await gateway.run({
      profileId: "default",
      userContext,
      prompt: "Please refund invoice 4521.",
      kbFilters: noKb,
    }).response;
    const response = await gateway.resume({
      userContext,
      runId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].runId : "",
      pauseId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].pauseId : "",
      decisions: [{action: EResumeAction.APPROVE}],
    }).response;
    expect([paused.kind, response.kind, refunded]).toEqual([EGatewayResponseKind.PAUSED, EGatewayResponseKind.ANSWER, ["4521"]]);
  });
});

describeWithOpenAi("AIGateway — M4 exit, real provider", () => {
  /** Memory on, written by the same real model; user facts are extracted after every answer. */
  const makeMemoryGateway = async (): Promise<{gateway: AIGateway; threadRepository: InMemoryThreadRepository}> => {
    const threadRepository = new InMemoryThreadRepository();
    return {
      threadRepository,
      gateway: await makeRealGateway({
        threadStore: {repository: threadRepository},
        workingMemory: {enabled: true},
        userMemoryStore: {
          repository: new InMemoryUserMemoryRepository(),
          enabled: true,
          extractEveryTurns: 2,
        },
        defaultCheapModelId: "model-a",
      }),
    };
  };

  test("after a question and its answer the thread has a summary and the user has facts", async () => {
    const {
      gateway,
      threadRepository,
    } = await makeMemoryGateway();
    const response = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "I am Anna, an accountant from Vienna, and I prefer short answers. Invoice 4521 has a total of 30 euros. Please confirm the total.",
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    const thread = await threadRepository.loadThread({
      tenantId: "tenant-a",
      threadId: response.threadId ?? "",
    });
    const facts = await gateway.getUserFacts({userContext});
    expect([Boolean(thread?.workingMemory.summary), thread?.workingMemory.updatedAtTurn, facts.length > 0]).toEqual([true, 2, true]);
  });

  test("a fact the user told in one thread is known in a new thread", async () => {
    const {gateway} = await makeMemoryGateway();
    await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "I am Anna, an accountant from Vienna. Please remember that about me.",
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    const response = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "What is my profession? Answer with one word.",
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    // The user's locale is de-AT, so the model may answer in German ("Buchhalterin")
    expect(response.kind === EGatewayResponseKind.ANSWER ? response.text : "").toMatch(/accountant|buchhalter/i);
  });
});

describeWithOpenAi("AIGateway — M5 exit, real provider", () => {
  /** A real embedding model and an index of its size; `overrides` switch on memory and the rewriter. */
  const makeKbGateway = async (overrides: Partial<IAIGatewayConfig> = {}): Promise<AIGateway> => {
    const gateway = await makeRealGateway({
      embedder: {
        embeddingModelId: "embedding-a",
        dimensions: EMBEDDING_DIMENSIONS,
      },
      vectorStore: {
        adapter: new InMemoryVectorIndexAdapter({
          embeddingModelId: "embedding-a",
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      },
      defaultCheapModelId: "model-a",
      ...overrides,
    });
    // An invented rule: the model cannot know it, the answer can only come from the chunk
    await gateway.kbIngestor.ingestDocument({
      tenantId: "tenant-a",
      doc: {
        id: "returns",
        bookId: "handbook",
        libraryId: "shop",
        title: "Returns at Nordwind Books",
        markdown: "# Time limits\nA customer of Nordwind Books can ask for a refund within 34 days of the delivery date. A damaged book can be returned within 14 months.",
        tags: [],
        language: "en",
      },
    });
    return gateway;
  };

  const inShop = {
    libraryIds: ["shop"],
    bookIds: [],
  };

  test("ask answers from an ingested document and cites its chunk", async () => {
    const gateway = await makeKbGateway();
    const response = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "How many days do I have to ask Nordwind Books for a refund? Answer with the number.",
      kbFilters: inShop,
    }).response;
    expect([response.kind === EGatewayResponseKind.ANSWER && response.text.includes("34"), response.kind === EGatewayResponseKind.ANSWER && response.citations])
      .toEqual([true, ["returns#0"]]);
  });

  test("a question that has nothing to do with the knowledge base gets no citations", async () => {
    const gateway = await makeKbGateway();
    const response = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "How tall is Mount Everest?",
      kbFilters: inShop,
    }).response;
    expect(response.kind === EGatewayResponseKind.ANSWER && response.citations).toEqual([]);
  });

  test("in a conversation the rewriter turns a follow-up into a query that names what \"it\" is", async () => {
    const gateway = await makeKbGateway({
      workingMemory: {enabled: true},
      userMemoryStore: {
        repository: new InMemoryUserMemoryRepository(),
        enabled: false,
      },
      queryRewriter: {enabled: true},
    });
    const first = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "Can I get a refund from Nordwind Books for a book I bought?",
      kbFilters: inShop,
    }).response;
    await gateway.whenIdle();
    await gateway.ask({
      profileId: "default",
      userContext,
      threadId: first.threadId,
      prompt: "And how long do I have for it when the book is damaged?",
      kbFilters: inShop,
    }).response;
    const [rewrite] = await gateway.trace.query({
      tenantId: "tenant-a",
      filters: {
        threadId: first.threadId,
        kind: ETraceKind.QUERY_REWRITE,
      },
      skip: 0,
      limit: 10,
    });
    expect(rewrite?.result?.text ?? "").toMatch(/refund|return|rückgabe|erstattung/i);
  });
});

describeWithOpenAi("AIGateway — M6 files, real provider", () => {
  /** A 128 × 128 PNG, all red. */
  const RED_PNG = "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAAxElEQVR42u3RMQ0AAAjAsPk3DTLgaDIFa1M6zAIAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABAADAAgAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAjAixYgaMOy89oM6gAAAABJRU5ErkJggg==";

  test("the model sees an uploaded image and names its colour", async () => {
    const gateway = await makeRealGateway();
    const model = await gateway.modelRegistry.getModel({modelId: "model-a"});
    await gateway.modelRegistry.upsertModel({
      model: {
        ...model,
        caps: {
          ...model.caps,
          images: true,
        },
      },
    });
    const file = await gateway.uploadFile({
      userContext,
      bytes: new Uint8Array(Buffer.from(RED_PNG, "base64")),
      mime: "image/png",
      name: "square.png",
    });
    const response = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "What is the colour of this image? Answer with one word.",
      files: [file],
      kbFilters: noKb,
    }).response;
    // The user's locale is de-AT, so the model may answer in German
    expect(response.kind === EGatewayResponseKind.ANSWER ? response.text : "").toMatch(/red|rot/i);
  });
});
