import {z} from "zod";
import {
  MockEmbeddingModelV4,
  MockLanguageModelV4,
  simulateReadableStream,
} from "ai/test";

import {
  DEFAULT_TOOL_REJECTION_TEXT,
  ILLMClientEvent,
  TGatewayResponse,
  AIGateway,
  InMemoryUsageAdapter,
  InMemoryUserMemoryRepository,
  EGatewayResponseKind,
  ELLMClientEventKind,
  EModelProvider,
  EPromptTemplateKey,
  EResumeAction,
  ETraceKind,
  ETurnRole,
  EUserMemoryFactOp,
  defineTool,
  EToolCallVerdict,
} from "../../..";
import {
  makeProfile,
  noKb,
  userContext,
} from "../../../tests/internal/utils/makeGateway";
import {makeGatewayConfig} from "../../../tests/internal/utils/makeGatewayConfig";

import {createEmbeddingModel} from "../utils/createEmbeddingModel";
import {createLanguageModel} from "../utils/createLanguageModel";

import {findToolOutput} from "./utils/llmClientFixtures";

// The M2, M3, M4 and M5 exits on the real loop: the gateway with the real LLMClient, the AI SDK and a mock model behind it.
// Only the creation of the provider model is replaced; request mapping, streaming, the loop and the hooks are the real ones.
// The test lives here because the SDK (and its mock model) may be imported in this folder only.
jest.mock("../utils/createLanguageModel");
jest.mock("../utils/createEmbeddingModel");

type TStream = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doStream"];
type TStreamResult = Awaited<ReturnType<Extract<TStream, (...args: never[]) => unknown>>>;
type TChunk = TStreamResult["stream"] extends ReadableStream<infer TPart> ? TPart : never;

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 2,
    text: 2,
    reasoning: undefined,
  },
};

const toolCallStep = (toolName: string): TChunk[] => [
  {
    type: "stream-start",
    warnings: [],
  },
  {
    type: "tool-call",
    toolCallId: `call-${toolName}`,
    toolName,
    input: JSON.stringify({invoiceId: "4521"}),
  },
  {
    type: "finish",
    finishReason: {
      unified: "tool-calls",
      raw: undefined,
    },
    usage,
  },
];

const textStep = (text: string): TChunk[] => [
  {
    type: "stream-start",
    warnings: [],
  },
  {
    type: "text-start",
    id: "text-1",
  },
  {
    type: "text-delta",
    id: "text-1",
    delta: text,
  },
  {
    type: "text-end",
    id: "text-1",
  },
  {
    type: "finish",
    finishReason: {
      unified: "stop",
      raw: undefined,
    },
    usage,
  },
];

interface ISetup {
  gateway: AIGateway;
  model: MockLanguageModelV4;
  /** The usage adapter of the config: what the gateway reported. */
  usageAdapter: InMemoryUsageAdapter;
  /** Names of the tools that were executed, in order. */
  executed: string[];

  loadRoles(threadId: string): Promise<ETurnRole[]>;
}

/** The tokens of every call the gateway reported to the usage adapter. */
const reportedTokens = ({usageAdapter}: ISetup): number =>
  usageAdapter.addUsageCalls.reduce((sum, call) => sum + call.usage.inputTokens + call.usage.outputTokens, 0);

/** A gateway on the real LLMClient whose mock model streams the given steps, one per model call. */
const setup = async (
  steps: TChunk[][],
  /** Memory on: the structured answers of the helper calls (not streamed), one per call, in order. */
  helperAnswers?: unknown[],
): Promise<ISetup> => {
  let call = 0;
  let helperCall = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => ({stream: simulateReadableStream({chunks: steps[call++]})}),
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(helperAnswers?.[helperCall++]),
        },
      ],
      finishReason: {
        unified: "stop",
        raw: undefined,
      },
      usage,
      warnings: [],
    }),
  });
  jest.mocked(createLanguageModel).mockReturnValue(model);
  // The embedding model of the KB: a vector that counts three words, 5 tokens per call
  jest.mocked(createEmbeddingModel).mockReturnValue(new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({values}) => ({
      embeddings: values.map(value => ["refund", "invoice", "weather"].map(word => value.toLowerCase().split(word).length - 1 + 0.01)),
      usage: {tokens: 5},
      warnings: [],
    }),
  }));

  const executed: string[] = [];
  const makeTool = (name: string, pauses: boolean): ReturnType<typeof defineTool<{ invoiceId: string }, unknown>> =>
    defineTool({
      name,
      description: `Tool ${name}`,
      inputSchema: z.object({invoiceId: z.string()}),
      tags: [],
      policy: pauses ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW,
      execute: async (): Promise<unknown> => {
        executed.push(name);
        return {ok: true};
      },
    });
  const usageAdapter = new InMemoryUsageAdapter();
  const config = {
    ...makeGatewayConfig(),
    usageGuard: {adapter: usageAdapter},
    workingMemory: {enabled: Boolean(helperAnswers)},
    userMemoryStore: {
      repository: new InMemoryUserMemoryRepository(),
      enabled: Boolean(helperAnswers),
      extractEveryTurns: 2,
    },
    defaultCheapModelId: "model-a",
    llmClient: {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}},
    toolRegistry: {tools: [makeTool("get_invoice", false), makeTool("refund", true)]},
  };
  const gateway = new AIGateway(config);
  await gateway.modelRegistry.upsertModel({
    model: {
      id: "model-a",
      provider: EModelProvider.OPENAI,
      providerModelId: "model-a-provider",
      label: "Model A",
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
  await gateway.modelRegistry.upsertModel({
    model: {
      id: "fake-embedding",
      provider: EModelProvider.OPENAI,
      providerModelId: "embedding-provider",
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
        costInPerMTokUsd: 1,
        costOutPerMTokUsd: 0,
      },
      enabled: true,
      deprecatedAt: null,
    },
  });
  await gateway.aiProfileStore.upsertProfile({
    tenantId: "tenant-a",
    profile: makeProfile("default", {allowedTools: ["get_invoice", "refund"]}),
  });

  return {
    gateway,
    model,
    usageAdapter,
    executed,
    loadRoles: async threadId => (await config.threadStore.repository.loadTurns({
      tenantId: "tenant-a",
      threadId,
      desc: false,
      skip: 0,
      limit: 100,
    })).map(turn => turn.role),
  };
};

const readEventKinds = async (events: AsyncIterable<ILLMClientEvent>): Promise<ELLMClientEventKind[]> => {
  const kinds: ELLMClientEventKind[] = [];
  for await (const event of events) kinds.push(event.kind);
  return kinds;
};

const run = ({gateway}: ISetup): Promise<TGatewayResponse> =>
  gateway.run({
    profileId: "default",
    userContext,
    prompt: "refund invoice 4521",
    kbFilters: noKb,
  }).response;

describe("LLMClient — M2 exit: the gateway's run and resume on the real LLMClient (SDK mock model)", () => {
  test("a tool without policy is executed and the run answers", async () => {
    const context = await setup([toolCallStep("get_invoice"), textStep("The total is 30.")]);
    const response = await run(context);
    expect([response.kind, response.kind === EGatewayResponseKind.ANSWER && response.text, context.executed]).toEqual([
      EGatewayResponseKind.ANSWER,
      "The total is 30.",
      ["get_invoice"],
    ]);
  });

  test("a policy: NEEDS_APPROVAL tool pauses the run before it is executed", async () => {
    const context = await setup([toolCallStep("refund")]);
    const response = await run(context);
    expect([response.kind, context.executed]).toEqual([EGatewayResponseKind.PAUSED, []]);
  });

  test("pause → resume APPROVE: the tool runs once and the run answers", async () => {
    const context = await setup([toolCallStep("refund"), textStep("Refunded.")]);
    const paused = await run(context);
    const response = await context.gateway.resume({
      userContext,
      runId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].runId : "",
      pauseId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].pauseId : "",
      decisions: [{action: EResumeAction.APPROVE}],
    }).response;
    expect([response.kind, response.kind === EGatewayResponseKind.ANSWER && response.text, context.executed]).toEqual([
      EGatewayResponseKind.ANSWER,
      "Refunded.",
      ["refund"],
    ]);
  });

  test("pause → resume APPROVE: the thread holds user, tool request, tool result, answer", async () => {
    const context = await setup([toolCallStep("refund"), textStep("Refunded.")]);
    const paused = await run(context);
    await context.gateway.resume({
      userContext,
      runId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].runId : "",
      pauseId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].pauseId : "",
      decisions: [{action: EResumeAction.APPROVE}],
    }).response;
    expect(await context.loadRoles(paused.threadId ?? "")).toEqual([ETurnRole.USER, ETurnRole.ASSISTANT, ETurnRole.TOOL, ETurnRole.ASSISTANT]);
  });

  test("pause → resume REJECT: the tool does not run and the model is told the execution was denied", async () => {
    const context = await setup([toolCallStep("refund"), textStep("Understood.")]);
    const paused = await run(context);
    await context.gateway.resume({
      userContext,
      runId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].runId : "",
      pauseId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].pauseId : "",
      decisions: [{
        action: EResumeAction.REJECT,
        text: "too expensive",
      }],
    }).response;
    expect([context.executed, findToolOutput(context.model.doStreamCalls[1].prompt)])
      .toEqual([
        [],
        {
          type: "execution-denied",
          reason: `${DEFAULT_TOOL_REJECTION_TEXT} Reason: too expensive`,
        },
      ]);
  });

  test("the model is offered the tools the profile allows", async () => {
    const context = await setup([textStep("hello")]);
    await run(context);
    expect((context.model.doStreamCalls[0].tools ?? []).map(tool => tool.name)).toEqual(["get_invoice", "refund"]);
  });
});

describe("LLMClient — M3 exit: usage, trace and stream of the gateway on the real LLMClient (SDK mock model)", () => {

  test("every model call of a run is reported to the usage adapter", async () => {
    const context = await setup([toolCallStep("get_invoice"), textStep("The total is 30.")]);
    await run(context);
    // 2 model calls × (10 input + 2 output tokens)
    expect(reportedTokens(context)).toBe(24);
  });

  test("every model call of a run has a trace entry with its cost, annotated with the template version", async () => {
    const context = await setup([toolCallStep("get_invoice"), textStep("The total is 30.")]);
    const response = await run(context);
    const entries = await context.gateway.trace.query({
      tenantId: "tenant-a",
      filters: {threadId: response.threadId},
      skip: 0,
      limit: 10,
    });
    expect(entries.map(entry => [entry.kind, entry.templateKey, entry.templateVersion, entry.costUsd > 0])).toEqual([
      [ETraceKind.RUN_STEP, EPromptTemplateKey.CHAT_MAIN, 0, true],
      [ETraceKind.RUN_STEP, EPromptTemplateKey.CHAT_MAIN, 0, true],
    ]);
  });

  test("ask streams the model's text on its events and then settles its response", async () => {
    const context = await setup([textStep("The total is 30.")]);
    const call = context.gateway.ask({
      profileId: "default",
      userContext,
      prompt: "what is the total of invoice 4521?",
      kbFilters: noKb,
    });
    expect(await readEventKinds(call.events)).toEqual([ELLMClientEventKind.TEXT_DELTA, ELLMClientEventKind.DONE]);
    expect((await call.response).kind).toBe(EGatewayResponseKind.ANSWER);
  });

  test("a run streams its tool activity and its text, and then settles its response", async () => {
    const context = await setup([toolCallStep("get_invoice"), textStep("The total is 30.")]);
    const call = context.gateway.run({
      profileId: "default",
      userContext,
      prompt: "refund invoice 4521",
      kbFilters: noKb,
    });
    const kinds = await readEventKinds(call.events);
    expect([
      kinds.includes(ELLMClientEventKind.TOOL_REQUEST),
      kinds.includes(ELLMClientEventKind.TOOL_RESULT),
      kinds.includes(ELLMClientEventKind.TEXT_DELTA),
      (await call.response).kind,
    ]).toEqual([true, true, true, EGatewayResponseKind.ANSWER]);
  });

});

describe("LLMClient — M4 exit: the gateway's memory on the real LLMClient (SDK mock model)", () => {
  const helperAnswers = [
    {
      summary: "The user asked for the total of invoice 4521; it is 30.",
      facts: [
        {
          key: "invoiceId",
          value: "4521",
        },
      ],
    },
    {
      facts: [
        {
          key: "role",
          value: "accountant",
          op: EUserMemoryFactOp.SET,
        },
      ],
    },
  ];

  const ask = async ({gateway}: ISetup, threadId?: string): Promise<string> => {
    const response = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "I am an accountant. What is the total of invoice 4521?",
      kbFilters: noKb,
      threadId,
    }).response;
    await gateway.whenIdle();
    return response.threadId ?? "";
  };

  test("after an answer the cheap model is asked twice, with a structured output and the transcript", async () => {
    const context = await setup([textStep("The total is 30.")], helperAnswers);
    await ask(context);
    expect(context.model.doGenerateCalls.map(call => [
      call.responseFormat?.type,
      JSON.stringify(call.prompt.at(-1)).includes("user: I am an accountant. What is the total of invoice 4521?\\nassistant: The total is 30."),
    ])).toEqual([["json", true], ["json", true]]);
  });

  test("the user's facts are stored from the model's structured answer", async () => {
    const context = await setup([textStep("The total is 30.")], helperAnswers);
    await ask(context);
    expect((await context.gateway.getUserFacts({userContext})).map(fact => [fact.key, fact.value])).toEqual([["role", "accountant"]]);
  });

  test("the next call of the thread sends both memories in its system prompt", async () => {
    const context = await setup([textStep("The total is 30."), textStep("Yes.")], [...helperAnswers, ...helperAnswers]);
    const threadId = await ask(context);
    await ask(context, threadId);
    const system = JSON.stringify(context.model.doStreamCalls[1].prompt[0]);
    expect([
      system.includes("About the user:\\n- role: accountant"),
      system.includes("About this conversation so far:\\nThe user asked for the total of invoice 4521; it is 30.\\n- invoiceId: 4521"),
    ]).toEqual([true, true]);
  });

  test("the helper calls are traced with their kind and reported to the usage adapter", async () => {
    const context = await setup([textStep("The total is 30.")], helperAnswers);
    const threadId = await ask(context);
    const entries = await context.gateway.trace.query({
      tenantId: "tenant-a",
      filters: {threadId},
      skip: 0,
      limit: 10,
    });
    expect([
      entries.map(entry => entry.kind).sort(),
      reportedTokens(context),
    ]).toEqual([[ETraceKind.CHAT, ETraceKind.MEMORY_USER, ETraceKind.MEMORY_WORKING].sort(), 36]);
  });
});

describe("LLMClient — M5 exit: the gateway's knowledge base on the real LLMClient (SDK mock models)", () => {
  const inTax = {
    libraryIds: ["tax"],
    bookIds: [],
  };

  /** A gateway with one refund document in the library "tax"; the main model answers with one text step per ask. */
  const setupKb = async (answers = 1): Promise<ISetup> => {
    const context = await setup(Array.from({length: answers}, () => textStep("Within 12 months.")));
    await context.gateway.kbIngestor.ingestDocument({
      tenantId: "tenant-a",
      doc: {
        id: "refund-doc",
        bookId: "tax-book",
        libraryId: "tax",
        title: "Refunds",
        markdown: "A refund is possible within 12 months.",
        tags: [],
        language: "en",
      },
      userId: "admin-a",
    });
    return context;
  };

  const ask = ({gateway}: ISetup): Promise<TGatewayResponse> =>
    gateway.ask({
      profileId: "default",
      userContext,
      prompt: "Can I get a refund?",
      kbFilters: inTax,
    }).response;

  test("ask finds the ingested chunk, sends it to the model and cites it", async () => {
    const context = await setupKb();
    const response = await ask(context);
    expect([
      response.kind === EGatewayResponseKind.ANSWER && response.citations,
      JSON.stringify(context.model.doStreamCalls[0].prompt[0]).includes("[refund-doc#0] Refunds\\nA refund is possible within 12 months."),
    ]).toEqual([["refund-doc#0"], true]);
  });

  test("the embedding calls of the ingestion and of the search are traced with the kind EMBED", async () => {
    const context = await setupKb();
    const response = await ask(context);
    const entries = await context.gateway.trace.query({
      tenantId: "tenant-a",
      filters: {kind: ETraceKind.EMBED},
      skip: 0,
      limit: 10,
    });
    expect(entries.map(entry => [entry.userId, entry.threadId, entry.usage.inputTokens]).sort()).toEqual([
      ["admin-a", undefined, 5],
      ["user-a", response.threadId, 5],
    ].sort());
  });

  test("the embedding calls are reported to the usage adapter next to the answer", async () => {
    const context = await setupKb();
    await ask(context);
    // 2 embedding calls × 5 tokens + the answer (10 + 2)
    expect(reportedTokens(context)).toBe(22);
  });
});
