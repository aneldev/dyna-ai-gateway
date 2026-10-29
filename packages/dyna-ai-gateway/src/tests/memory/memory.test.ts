import {z} from "zod";

import {
  IAIGatewayConfig,
  IThread,
  InMemoryUserMemoryRepository,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ETraceKind,
  EUserMemoryFactOp,
  joinSystem,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {
  IGatewaySetup,
  makeGateway,
  makeModelResult,
  makeProfile,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";
import {
  makeCall,
  makeToolGateway,
} from "../internal/utils/makeToolGateway";

const input = {
  profileId: "default",
  userContext,
  prompt: "refund invoice 4521",
  kbFilters: noKb,
};

/** Memory switched on; user facts are extracted every `extractEveryTurns` turns (2 = after every answer of ask). */
const memoryConfig = (extractEveryTurns = 2, rememberNeedsApproval?: boolean): Partial<IAIGatewayConfig> => ({
  workingMemory: {enabled: true},
  userMemoryStore: {
    repository: new InMemoryUserMemoryRepository(),
    enabled: true,
    extractEveryTurns,
    rememberNeedsApproval,
  },
});

const toList = (record: Record<string, string>): Array<{key: string; value: string}> =>
  Object.entries(record).map(([key, value]) => ({
    key,
    value,
  }));

/** The cheap model's next answer to the extraction of user facts. */
const scriptUserFacts = (llmClient: FakeLLMClient, facts: Record<string, string>): void =>
  llmClient.enqueueComplete(makeModelResult({
    structured: {
      facts: toList(facts).map(fact => ({
        ...fact,
        op: EUserMemoryFactOp.SET,
      })),
    },
  }), ETraceKind.MEMORY_USER);

/** The cheap model's next answer to the thread-memory update. */
const scriptThreadMemory = (llmClient: FakeLLMClient, summary: string, facts: Record<string, string> = {}): void =>
  llmClient.enqueueComplete(makeModelResult({
    structured: {
      summary,
      facts: toList(facts),
    },
  }), ETraceKind.MEMORY_WORKING);

/** One ask whose memory calls answer with the given summary and user facts; waits for the background work. */
const askAndRemember = async (setup: IGatewaySetup, summary: string, userFacts: Record<string, string> = {}, threadId?: string): Promise<string> => {
  setup.llmClient.enqueueComplete(makeModelResult());
  scriptThreadMemory(setup.llmClient, summary, {invoiceId: "4521"});
  scriptUserFacts(setup.llmClient, userFacts);
  const response = await setup.gateway.ask({
    ...input,
    threadId,
  }).response;
  await setup.gateway.whenIdle();
  return response.threadId ?? "";
};

const loadThread = async ({config}: IGatewaySetup, threadId: string): Promise<IThread | null> =>
  config.threadStore.repository.loadThread({
    tenantId: "tenant-a",
    threadId,
  });

const getHelperCalls = ({llmClient}: IGatewaySetup): FakeLLMClient["completeCalls"] =>
  llmClient.completeCalls.filter(call => call.meta.kind !== ETraceKind.CHAT);

const getText = (call: FakeLLMClient["completeCalls"][number]): string =>
  call.request.messages.flatMap(message => message.parts.map(part => part.kind === EPartKind.TEXT ? part.text : "")).join("\n");

describe("AIGateway — M4: memory", () => {
  afterEach(() => jest.restoreAllMocks());

  describe("the thread's working memory", () => {
    test("after 2 turns the summary is not empty and the facts contain the scripted key", async () => {
      const setup = await makeGateway(memoryConfig());
      const threadId = await askAndRemember(setup, "The user wants a refund for invoice 4521.");
      expect((await loadThread(setup, threadId))?.workingMemory).toEqual({
        summary: "The user wants a refund for invoice 4521.",
        facts: {invoiceId: "4521"},
        updatedAtTurn: 2,
      });
    });

    test("the update reads the turns of the call: the question and the answer", async () => {
      const setup = await makeGateway(memoryConfig());
      await askAndRemember(setup, "summary");
      const [call] = getHelperCalls(setup).filter(helper => helper.meta.kind === ETraceKind.MEMORY_WORKING);
      expect(getText(call)).toBe("user: refund invoice 4521\nassistant: The answer");
    });

    test("the next update reads only the turns that came after the last one", async () => {
      const setup = await makeGateway(memoryConfig());
      const threadId = await askAndRemember(setup, "first");
      await askAndRemember(setup, "second", {}, threadId);
      const calls = getHelperCalls(setup).filter(helper => helper.meta.kind === ETraceKind.MEMORY_WORKING);
      expect([getText(calls[1]).split("\n").length, (await loadThread(setup, threadId))?.workingMemory.updatedAtTurn]).toEqual([2, 4]);
    });

    test("the summary and the thread's facts are in the system prompt of the next call of the thread", async () => {
      const setup = await makeGateway(memoryConfig());
      const threadId = await askAndRemember(setup, "The user wants a refund for invoice 4521.");
      await askAndRemember(setup, "second", {}, threadId);
      const mainCalls = setup.llmClient.completeCalls.filter(call => call.meta.kind === ETraceKind.CHAT);
      expect(joinSystem({blocks: mainCalls[1].request.system})).toContain("About this conversation so far:\nThe user wants a refund for invoice 4521.\n- invoiceId: 4521");
    });
  });

  describe("the user's facts", () => {
    test("user facts appear in the system prompt of the next call, in another thread too", async () => {
      const setup = await makeGateway(memoryConfig());
      await askAndRemember(setup, "summary", {language: "German"});
      await askAndRemember(setup, "summary");
      const mainCalls = setup.llmClient.completeCalls.filter(call => call.meta.kind === ETraceKind.CHAT);
      expect([joinSystem({blocks: mainCalls[0].request.system}).includes("About the user"), joinSystem({blocks: mainCalls[1].request.system}).includes("About the user:\n- language: German")]).toEqual([false, true]);
    });

    test("getUserFacts returns what was extracted, with the thread it came from", async () => {
      const setup = await makeGateway(memoryConfig());
      const threadId = await askAndRemember(setup, "summary", {language: "German"});
      expect(await setup.gateway.getUserFacts({userContext})).toMatchObject([
        {
          key: "language",
          value: "German",
          sourceThreadId: threadId,
        },
      ]);
    });

    test("removeUserFact removes the fact", async () => {
      const setup = await makeGateway(memoryConfig());
      await askAndRemember(setup, "summary", {
        language: "German",
        role: "accountant",
      });
      await setup.gateway.removeUserFact({
        userContext,
        key: "language",
      });
      expect((await setup.gateway.getUserFacts({userContext})).map(fact => fact.key)).toEqual(["role"]);
    });

    test("another user of the tenant does not see the facts", async () => {
      const setup = await makeGateway(memoryConfig());
      await askAndRemember(setup, "summary", {language: "German"});
      expect(await setup.gateway.getUserFacts({
        userContext: {
          ...userContext,
          userId: "user-b",
        },
      })).toEqual([]);
    });

    test("facts are extracted after the first answer and then when the thread crosses a multiple of extractEveryTurns", async () => {
      const setup = await makeGateway(memoryConfig(4));
      const threadId = await askAndRemember(setup, "first");
      const extractionsAfterFirst = getHelperCalls(setup).filter(call => call.meta.kind === ETraceKind.MEMORY_USER).length;
      await askAndRemember(setup, "second", {}, threadId);
      const extractionsAfterSecond = getHelperCalls(setup).filter(call => call.meta.kind === ETraceKind.MEMORY_USER).length;
      await askAndRemember(setup, "third", {}, threadId);
      const extractions = getHelperCalls(setup).filter(call => call.meta.kind === ETraceKind.MEMORY_USER);
      // The first extraction sees the 2 turns of the first call; the one at turn 4 sees the turns since the last multiple (all 4)
      expect([extractionsAfterFirst, extractionsAfterSecond, extractions.length, getText(extractions[0]).split("\n").length, getText(extractions[1]).split("\n").length])
        .toEqual([1, 2, 2, 2, 4]);
    });
  });

  describe("the helper calls", () => {
    test("use the platform's cheap model and carry the tenant, the user, the thread and their kind", async () => {
      const setup = await makeGateway(memoryConfig());
      const threadId = await askAndRemember(setup, "summary");
      expect(getHelperCalls(setup).map(call => [call.request.modelId, call.meta])).toEqual([ETraceKind.MEMORY_WORKING, ETraceKind.MEMORY_USER].map(kind => [
        "fake-cheap",
        {
          tenantId: "tenant-a",
          userId: "user-a",
          profileId: "default",
          threadId,
          kind,
        },
      ]));
    });

    test("use the cheap model of the profile when it names one", async () => {
      const setup = await makeGateway(memoryConfig());
      await setup.gateway.aiProfileStore.upsertProfile({
        tenantId: "tenant-a",
        profile: makeProfile("thrifty", {cheapModelId: "model-b"}),
      });
      setup.llmClient.enqueueComplete(makeModelResult());
      scriptThreadMemory(setup.llmClient, "summary");
      scriptUserFacts(setup.llmClient, {});
      await setup.gateway.ask({
        ...input,
        profileId: "thrifty",
      }).response;
      await setup.gateway.whenIdle();
      expect(getHelperCalls(setup).map(call => call.request.modelId)).toEqual(["model-b", "model-b"]);
    });

    test("are reported to the usage adapter and traced with their kind", async () => {
      const setup = await makeGateway(memoryConfig());
      const threadId = await askAndRemember(setup, "summary");
      const entries = await setup.gateway.trace.query({
        tenantId: "tenant-a",
        filters: {threadId},
        skip: 0,
        limit: 10,
      });
      // The fake's results share one trace id, so the usage is the proof of three calls: 3 × (10 + 2) tokens
      const reported = setup.usageAdapter.addUsageCalls.reduce((sum, call) => sum + call.usage.inputTokens + call.usage.outputTokens, 0);
      expect([reported, entries.length > 0]).toEqual([36, true]);
    });
  });

  describe("in the background", () => {
    test("the answer does not wait for the memory", async () => {
      const setup = await makeGateway(memoryConfig());
      let release: () => void = () => undefined;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const complete = setup.llmClient.complete.bind(setup.llmClient);
      jest.spyOn(setup.llmClient, "complete").mockImplementation(async args => {
        if (args.meta.kind !== ETraceKind.CHAT) await gate;
        return complete(args);
      });
      setup.llmClient.enqueueComplete(makeModelResult());
      scriptThreadMemory(setup.llmClient, "summary");
      scriptUserFacts(setup.llmClient, {});

      const response = await setup.gateway.ask(input).response;
      const summaryAtAnswer = (await loadThread(setup, response.threadId ?? ""))?.workingMemory.summary;
      release();
      await setup.gateway.whenIdle();
      expect([response.kind, summaryAtAnswer, (await loadThread(setup, response.threadId ?? ""))?.workingMemory.summary])
        .toEqual([EGatewayResponseKind.ANSWER, "", "summary"]);
    });

    test("a memory call that fails does not fail the answer and is reported", async () => {
      const setup = await makeGateway(memoryConfig());
      const report = jest.spyOn(console, "error").mockImplementation(() => undefined);
      // Only the main call is scripted: both helper calls throw in the FakeLLMClient
      setup.llmClient.enqueueComplete(makeModelResult());
      const response = await setup.gateway.ask(input).response;
      await setup.gateway.whenIdle();
      expect([response.kind, report.mock.calls.length, (await loadThread(setup, response.threadId ?? ""))?.workingMemory.summary])
        .toEqual([EGatewayResponseKind.ANSWER, 2, ""]);
    });

    test("whenIdle resolves when nothing is running", async () => {
      const {gateway} = await makeGateway(memoryConfig());
      await expect(gateway.whenIdle()).resolves.toBeUndefined();
    });
  });

  describe("when no memory call is made", () => {
    test("memory switched off: the main call is the only model call", async () => {
      const setup = await makeGateway();
      setup.llmClient.enqueueComplete(makeModelResult());
      await setup.gateway.ask(input).response;
      await setup.gateway.whenIdle();
      expect(setup.llmClient.completeCalls).toHaveLength(1);
    });

    test("an answer that fails the checks is not remembered", async () => {
      const setup = await makeGateway(memoryConfig());
      setup.llmClient.enqueueComplete(makeModelResult({text: "not what the schema asks for"}));
      const response = await setup.gateway.ask({
        ...input,
        outputSchema: z.object({total: z.number()}),
      }).response;
      await setup.gateway.whenIdle();
      expect([response.kind, getHelperCalls(setup).length]).toEqual([EGatewayResponseKind.FAILED, 0]);
    });
  });

  describe("run and resume", () => {
    const makeMemoryToolGateway = (): ReturnType<typeof makeToolGateway> => makeToolGateway(memoryConfig());

    test("a finished run is remembered, tool activity included", async () => {
      const setup = await makeMemoryToolGateway();
      setup.llmClient.enqueueRunStep({toolCall: makeCall("get_invoice")});
      setup.llmClient.enqueueRunStep({text: "The total is 30."});
      scriptThreadMemory(setup.llmClient, "The total of invoice 4521 is 30.");
      scriptUserFacts(setup.llmClient, {});
      const response = await setup.gateway.run(input).response;
      await setup.gateway.whenIdle();
      const [update] = getHelperCalls(setup);
      expect([(await loadThread(setup, response.threadId ?? ""))?.workingMemory.summary, getText(update).split("\n")]).toEqual([
        "The total of invoice 4521 is 30.",
        [
          "user: refund invoice 4521",
          "assistant calls get_invoice: {\"invoiceId\":\"4521\"}",
          "tool get_invoice: {\"total\":30}",
          "assistant: The total is 30.",
        ],
      ]);
    });

    test("a paused run is not remembered until it is resumed and answers", async () => {
      const setup = await makeMemoryToolGateway();
      setup.llmClient.enqueueRunStep({toolCall: makeCall("refund")});
      const paused = await setup.gateway.run(input).response;
      await setup.gateway.whenIdle();
      const callsWhilePaused = getHelperCalls(setup).length;

      setup.llmClient.enqueueRunStep({text: "Refunded."});
      scriptThreadMemory(setup.llmClient, "Invoice 4521 was refunded.");
      scriptUserFacts(setup.llmClient, {});
      await setup.gateway.resume({
        userContext,
        runId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].runId : "",
        pauseId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].pauseId : "",
        decisions: [{action: EResumeAction.APPROVE}],
      }).response;
      await setup.gateway.whenIdle();
      expect([callsWhilePaused, (await loadThread(setup, paused.threadId ?? ""))?.workingMemory]).toEqual([
        0,
        {
          summary: "Invoice 4521 was refunded.",
          facts: {},
          updatedAtTurn: 4,
        },
      ]);
    });
  });
});

describe("AIGateway — M6: the memory tools (D61)", () => {
  /** One run whose model calls a memory tool and then answers; the background memory calls are scripted empty. */
  const runWithTool = async (setup: IGatewaySetup, toolName: string, toolInput: Record<string, string>): ReturnType<IGatewaySetup["gateway"]["run"]>["response"] => {
    setup.llmClient.enqueueRunStep({
      toolCall: {
        kind: EPartKind.TOOL_CALL,
        callId: `call-${toolName}`,
        toolName,
        input: toolInput,
      },
    });
    setup.llmClient.enqueueRunStep({text: "Noted."});
    scriptThreadMemory(setup.llmClient, "summary");
    scriptUserFacts(setup.llmClient, {});
    const response = await setup.gateway.run({
      ...input,
      prompt: "I am based in Vienna, remember this",
    }).response;
    await setup.gateway.whenIdle();
    return response;
  };

  const factList = async (setup: IGatewaySetup): Promise<Array<[string, string]>> =>
    (await setup.gateway.getUserFacts({userContext})).map(fact => [fact.key, fact.value]);

  test("a run offers remember_user_fact and forget_user_fact although the profile allows no tool", async () => {
    const setup = await makeGateway(memoryConfig());
    await runWithTool(setup, "remember_user_fact", {
      key: "location",
      value: "Vienna",
    });
    expect(setup.llmClient.runCalls[0].tools.map(tool => tool.name)).toEqual(["remember_user_fact", "forget_user_fact"]);
  });

  test("with rememberNeedsApproval false, remember_user_fact stores the fact at once, without a pause for approval", async () => {
    const setup = await makeGateway(memoryConfig(2, false));
    const response = await runWithTool(setup, "remember_user_fact", {
      key: "location",
      value: "Vienna",
    });
    expect([response.kind, await factList(setup)]).toEqual([EGatewayResponseKind.ANSWER, [["location", "Vienna"]]]);
  });

  test("forget_user_fact removes a stored fact", async () => {
    const setup = await makeGateway(memoryConfig());
    await setup.gateway.upsertUserFact({
      userContext,
      key: "location",
      value: "Vienna",
    });
    await runWithTool(setup, "forget_user_fact", {key: "location"});
    expect(await factList(setup)).toEqual([]);
  });

  test("with the user memory switched off the tools do not exist", async () => {
    const setup = await makeGateway();
    expect(setup.gateway.toolRegistry.list().map(tool => tool.name)).toEqual([]);
  });
});

describe("AIGateway — M6: memory for the UI", () => {
  afterEach(() => jest.restoreAllMocks());

  const userB = {
    ...userContext,
    userId: "user-b",
  };

  describe("the user's facts", () => {
    test("upsertUserFact sets a fact that the next call knows, without a thread it came from", async () => {
      const setup = await makeGateway(memoryConfig());
      await setup.gateway.upsertUserFact({
        userContext,
        key: "language",
        value: "German",
      });
      await askAndRemember(setup, "summary");
      const [mainCall] = setup.llmClient.completeCalls.filter(call => call.meta.kind === ETraceKind.CHAT);
      expect([joinSystem({blocks: mainCall.request.system}).includes("About the user:\n- language: German"), (await setup.gateway.getUserFacts({userContext}))[0].sourceThreadId])
        .toEqual([true, undefined]);
    });

    test("upsertUserFact replaces the fact of the same key", async () => {
      const setup = await makeGateway(memoryConfig());
      await askAndRemember(setup, "summary", {language: "German"});
      await setup.gateway.upsertUserFact({
        userContext,
        key: "language",
        value: "English",
      });
      expect((await setup.gateway.getUserFacts({userContext})).map(({
        key,
        value,
      }) => [key, value])).toEqual([["language", "English"]]);
    });

    test("upsertUserFact with an empty value is a 400", async () => {
      const {gateway} = await makeGateway(memoryConfig());
      await expect(gateway.upsertUserFact({
        userContext,
        key: "language",
        value: " ",
      })).rejects.toMatchObject({
        code: 5372597957094,
        status: 400,
      });
    });

    test("clearUserFacts removes every fact of the user and leaves another user's", async () => {
      const setup = await makeGateway(memoryConfig());
      await askAndRemember(setup, "summary", {
        language: "German",
        role: "accountant",
      });
      await setup.gateway.upsertUserFact({
        userContext: userB,
        key: "language",
        value: "French",
      });
      await setup.gateway.clearUserFacts({userContext});
      expect([(await setup.gateway.getUserFacts({userContext})).length, (await setup.gateway.getUserFacts({userContext: userB})).length]).toEqual([0, 1]);
    });
  });

  describe("the thread's memory", () => {
    test("getThreadMemory returns the summary and the facts of the thread", async () => {
      const setup = await makeGateway(memoryConfig());
      const threadId = await askAndRemember(setup, "The user wants a refund.");
      expect(await setup.gateway.getThreadMemory({
        userContext,
        threadId,
      })).toEqual({
        summary: "The user wants a refund.",
        facts: {invoiceId: "4521"},
        updatedAtTurn: 2,
      });
    });

    test("getThreadMemory of another user's thread is a 404", async () => {
      const setup = await makeGateway(memoryConfig());
      const threadId = await askAndRemember(setup, "summary");
      await expect(setup.gateway.getThreadMemory({
        userContext: userB,
        threadId,
      })).rejects.toMatchObject({
        code: 5372799784161,
        status: 404,
      });
    });

    test("resetThreadMemory clears the memory: the next call has none, the next update reads only the new turns", async () => {
      const setup = await makeGateway(memoryConfig());
      const threadId = await askAndRemember(setup, "The user wants a refund.");
      await setup.gateway.resetThreadMemory({
        userContext,
        threadId,
      });
      await askAndRemember(setup, "second", {}, threadId);
      const mainCalls = setup.llmClient.completeCalls.filter(call => call.meta.kind === ETraceKind.CHAT);
      const updates = getHelperCalls(setup).filter(call => call.meta.kind === ETraceKind.MEMORY_WORKING);
      expect([joinSystem({blocks: mainCalls[1].request.system}).includes("About this conversation"), getText(updates[1]).split("\n").length]).toEqual([false, 2]);
    });

    test("resetThreadMemory waits for the update that is already queued, so it cannot bring the memory back", async () => {
      const setup = await makeGateway(memoryConfig());
      let release: () => void = () => undefined;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const complete = setup.llmClient.complete.bind(setup.llmClient);
      jest.spyOn(setup.llmClient, "complete").mockImplementation(async args => {
        if (args.meta.kind !== ETraceKind.CHAT) await gate;
        return complete(args);
      });
      setup.llmClient.enqueueComplete(makeModelResult());
      scriptThreadMemory(setup.llmClient, "summary");
      scriptUserFacts(setup.llmClient, {});
      const response = await setup.gateway.ask(input).response;
      const threadId = response.threadId ?? "";

      const reset = setup.gateway.resetThreadMemory({
        userContext,
        threadId,
      });
      release();
      await reset;
      expect((await loadThread(setup, threadId))?.workingMemory).toEqual({
        summary: "",
        facts: {},
        updatedAtTurn: 2,
      });
    });

    test("resetThreadMemory of another user's thread is a 404 and the memory stays", async () => {
      const setup = await makeGateway(memoryConfig());
      const threadId = await askAndRemember(setup, "summary");
      await expect(setup.gateway.resetThreadMemory({
        userContext: userB,
        threadId,
      })).rejects.toMatchObject({
        code: 5372799784161,
        status: 404,
      });
      expect((await loadThread(setup, threadId))?.workingMemory.summary).toBe("summary");
    });
  });
});
