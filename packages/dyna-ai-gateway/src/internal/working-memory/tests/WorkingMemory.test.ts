import {
  InMemoryPromptTemplateRepository,
  InMemoryThreadRepository,
} from "../../../adapters/in-memory";
import {
  ITurn,
  EPartKind,
  ETurnRole,
} from "../../../contracts";
import {countTokens} from "../../../utils/tokens/countTokens";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {IAIProfile} from "../../ai-profile-store";
import {
  ILLMClientCallMeta,
  IModelRequest,
  IModelResult,
  EFinishReason,
} from "../../llm-client";
import {makeModel} from "../../llm-client/tests/utils/llmClientFixtures";
import {EModelProvider} from "../../model-registry";
import {PromptTemplateStore} from "../../prompt-template-store";
import {ThreadStore} from "../../thread-store";
import {ETraceKind} from "../../trace";
import {TurnBuilder} from "../../turn-builder";

import {WorkingMemory} from "../WorkingMemory";
import {
  IWorkingMemoryConfig,
  IWorkingMemoryLoad,
  IWorkingMemoryState,
  EWorkingMemoryStrategy,
  TWorkingMemoryStrategy,
} from "../types";

interface ISetup {
  memory: WorkingMemory;
  threadStore: ThreadStore;
  llmClient: FakeLLMClient;
  threadId: string;
}

const setup = async (config: IWorkingMemoryConfig = {enabled: true}): Promise<ISetup> => {
  const threadStore = new ThreadStore({repository: new InMemoryThreadRepository()});
  const thread = await threadStore.createThread({
    tenantId: "tenant-a",
    userId: "user-a",
  });
  const llmClient = new FakeLLMClient();
  return {
    llmClient,
    memory: new WorkingMemory(config, {
      llmClient,
      promptTemplateStore: new PromptTemplateStore({repository: new InMemoryPromptTemplateRepository()}),
      threadStore,
      turnBuilder: new TurnBuilder(),
    }),
    threadStore,
    threadId: thread.id,
  };
};

const address = (threadId: string): {tenantId: string; threadId: string} => ({
  tenantId: "tenant-a",
  threadId,
});

const makeState = (overrides: Partial<IWorkingMemoryState> = {}): IWorkingMemoryState => ({
  summary: "The user asks about invoice 4521.",
  facts: {role: "accountant"},
  updatedAtTurn: 2,
  ...overrides,
});

const makeTurns = (count: number, role: ETurnRole = ETurnRole.USER): ITurn[] =>
  Array.from({length: count}, (_item, index): ITurn => ({
    id: `turn-${index}`,
    role,
    parts: [
      {
        kind: EPartKind.TEXT,
        text: `text ${index}`,
      },
    ],
    createdAt: new Date(1_000),
  }));

const makeProfile = (workingMemory?: TWorkingMemoryStrategy): IAIProfile => ({
  id: "profile-a",
  tenantId: "tenant-a",
  name: "Profile A",
  modelId: "model-a",
  allowedTools: [],
  approvals: [],
  promptAddendum: "",
  limits: {
    maxStepsPerRun: 5,
    maxOutputTokens: 500,
  },
  workingMemory,
});

const model = makeModel("model-a", EModelProvider.OPENAI);
/** Tokens of one `makeTurns` turn, as the memory counts them. */
const turnTokens = countTokens({
  text: "text 0",
  provider: EModelProvider.OPENAI,
});
const texts = (load: IWorkingMemoryLoad): string[] =>
  load.messages.map(message => message.parts.map(part => part.kind === EPartKind.TEXT ? part.text : part.kind).join("|"));

const appendTurns = async (
  {
    threadStore,
    threadId,
  }: ISetup,
  count: number,
): Promise<void> => {
  for (const turn of makeTurns(count)) {
    await threadStore.appendTurn({
      ...address(threadId),
      turn,
    });
  }
};

const meta: ILLMClientCallMeta = {
  tenantId: "tenant-a",
  userId: "user-a",
  threadId: "thread-1",
  kind: ETraceKind.MEMORY_WORKING,
};

const request: IModelRequest = {
  modelId: "model-a",
  system: [],
  messages: [],
  maxOutputTokens: 500,
};

const result: IModelResult = {
  modelId: "model-a",
  text: "answer",
  toolCalls: [],
  finishReason: EFinishReason.STOP,
  usage: {
    inputTokens: 10,
    outputTokens: 2,
  },
  latencyMs: 1,
  traceId: "trace-1",
};

const enqueue = (llmClient: FakeLLMClient, structured: unknown): void => llmClient.enqueueComplete({
  modelId: "cheap-model",
  text: JSON.stringify(structured) ?? "",
  structured,
  toolCalls: [],
  finishReason: EFinishReason.STOP,
  usage: {
    inputTokens: 10,
    outputTokens: 2,
  },
  latencyMs: 1,
  traceId: "trace-1",
}, ETraceKind.MEMORY_WORKING);

describe("WorkingMemory", () => {
  describe("load", () => {
    const load = (context: ISetup, profile = makeProfile(), budgetTokens = 100_000): Promise<IWorkingMemoryLoad> => context.memory.load({
      ...address(context.threadId),
      profile,
      model,
      budgetTokens,
    });

    test("switched off: the last 20 turns, no notes, even with a stored state", async () => {
      const context = await setup({enabled: false});
      await appendTurns(context, 25);
      await context.threadStore.setWorkingMemory({
        ...address(context.threadId),
        state: makeState(),
      });
      const loaded = await load(context);
      expect([texts(loaded).length, texts(loaded)[0], texts(loaded)[19], loaded.notes, loaded.issues]).toEqual([20, "text 5", "text 24", "", []]);
    });

    test("SUMMARY_BUFFER is the default: the stored summary and facts as the notes, the last 20 turns as the messages", async () => {
      const context = await setup();
      await appendTurns(context, 25);
      await context.threadStore.setWorkingMemory({
        ...address(context.threadId),
        state: makeState(),
      });
      const loaded = await load(context);
      expect([texts(loaded).length, texts(loaded)[0], loaded.notes, loaded.issues]).toEqual([
        20,
        "text 5",
        "About this conversation so far:\nThe user asks about invoice 4521.\n- role: accountant",
        [],
      ]);
    });

    test("SUMMARY_BUFFER: no notes while nothing is stored; recentTurns sizes the tail", async () => {
      const context = await setup({
        enabled: true,
        strategy: {
          type: EWorkingMemoryStrategy.SUMMARY_BUFFER,
          recentTurns: 3,
        },
      });
      await appendTurns(context, 10);
      const loaded = await load(context);
      expect([texts(loaded), loaded.notes]).toEqual([["text 7", "text 8", "text 9"], ""]);
    });

    test("the profile's strategy overrides the config's", async () => {
      const context = await setup({
        enabled: true,
        strategy: {type: EWorkingMemoryStrategy.SLIDING_WINDOW},
      });
      await appendTurns(context, 2);
      await context.threadStore.setWorkingMemory({
        ...address(context.threadId),
        state: makeState(),
      });
      const [bySliding, bySummary] = await Promise.all([
        load(context),
        load(context, makeProfile({type: EWorkingMemoryStrategy.SUMMARY_BUFFER})),
      ]);
      expect([bySliding.notes, bySummary.notes.startsWith("About this conversation so far:")]).toEqual(["", true]);
    });

    test("SLIDING_WINDOW ignores the stored state: no notes", async () => {
      const context = await setup({
        enabled: true,
        strategy: {type: EWorkingMemoryStrategy.SLIDING_WINDOW},
      });
      await appendTurns(context, 2);
      await context.threadStore.setWorkingMemory({
        ...address(context.threadId),
        state: makeState(),
      });
      expect((await load(context)).notes).toBe("");
    });

    test("SLIDING_WINDOW keeps the newest turns that fit chatHistoryRatio × budgetTokens, with a WARNING turns_trimmed", async () => {
      const context = await setup({
        enabled: true,
        strategy: {
          type: EWorkingMemoryStrategy.SLIDING_WINDOW,
          chatHistoryRatio: 0.5,
        },
      });
      await appendTurns(context, 10);
      // Half of the budget is exactly three turns
      const loaded = await load(context, makeProfile(), turnTokens * 6);
      expect([texts(loaded), loaded.issues.map(issue => issue.code)]).toEqual([["text 7", "text 8", "text 9"], ["turns_trimmed"]]);
    });

    test("SLIDING_WINDOW: a budget below one turn still keeps the last turn", async () => {
      const context = await setup({
        enabled: true,
        strategy: {type: EWorkingMemoryStrategy.SLIDING_WINDOW},
      });
      await appendTurns(context, 3);
      const loaded = await load(context, makeProfile(), 1);
      expect([texts(loaded), loaded.issues.map(issue => issue.code)]).toEqual([["text 2"], ["turns_trimmed"]]);
    });

    test("SLIDING_WINDOW: when every turn fits there is no issue", async () => {
      const context = await setup({
        enabled: true,
        strategy: {type: EWorkingMemoryStrategy.SLIDING_WINDOW},
      });
      await appendTurns(context, 3);
      const loaded = await load(context);
      expect([texts(loaded), loaded.issues]).toEqual([["text 0", "text 1", "text 2"], []]);
    });

    test("SLIDING_WINDOW: maxLoadedTurns caps the read before the budget does", async () => {
      const context = await setup({
        enabled: true,
        strategy: {
          type: EWorkingMemoryStrategy.SLIDING_WINDOW,
          maxLoadedTurns: 4,
        },
      });
      await appendTurns(context, 10);
      const loaded = await load(context);
      expect([texts(loaded), loaded.issues.map(issue => issue.code)]).toEqual([["text 6", "text 7", "text 8", "text 9"], ["turns_trimmed"]]);
    });

    test("the window opens on a user turn: a leading assistant turn is dropped", async () => {
      const context = await setup({
        enabled: true,
        strategy: {
          type: EWorkingMemoryStrategy.SLIDING_WINDOW,
          chatHistoryRatio: 1,
        },
      });
      const turns = [
        ...makeTurns(1, ETurnRole.USER),
        ...makeTurns(2, ETurnRole.ASSISTANT).map(turn => ({
          ...turn,
          id: `assistant-${turn.id}`,
        })),
        ...makeTurns(1, ETurnRole.USER).map(turn => ({
          ...turn,
          id: "last",
          parts: [
            {
              kind: EPartKind.TEXT as const,
              text: "text 3",
            },
          ],
        })),
      ];
      for (const turn of turns) {
        await context.threadStore.appendTurn({
          ...address(context.threadId),
          turn,
        });
      }
      // Three turns fit: the two assistant turns and the last user turn; the window opens on the user turn
      const loaded = await load(context, makeProfile(), turnTokens * 3);
      expect(texts(loaded)).toEqual(["text 3"]);
    });

    test("an unknown thread is a 404", async () => {
      const context = await setup();
      await expect(context.memory.load({
        ...address("missing"),
        profile: makeProfile(),
        model,
        budgetTokens: 1_000,
      })).rejects.toMatchObject({status: 404});
    });
  });

  describe("saveContext", () => {
    const answer = {
      summary: "The user wants a refund for invoice 4521.",
      facts: [
        {
          key: "invoiceId",
          value: "4521",
        },
      ],
    };

    const saveContext = (context: ISetup, profile = makeProfile()): Promise<void> => context.memory.saveContext({
      ...address(context.threadId),
      userId: "user-a",
      profile,
      request,
      result,
      cheapModelId: "cheap-model",
      meta,
    });

    const silence = (): jest.SpyInstance => jest.spyOn(console, "error").mockImplementation(() => undefined);
    afterEach(() => jest.restoreAllMocks());

    test("SUMMARY_BUFFER: the turns since the last update go to the cheap model, the state is stored up to the thread's turnCount", async () => {
      const context = await setup();
      await appendTurns(context, 4);
      await context.threadStore.setWorkingMemory({
        ...address(context.threadId),
        state: makeState({updatedAtTurn: 2}),
      });
      enqueue(context.llmClient, answer);
      await saveContext(context);
      const [call] = context.llmClient.completeCalls;
      expect([
        call.request.modelId,
        call.meta,
        call.request.messages[0].parts,
        await context.memory.getState(address(context.threadId)),
      ]).toEqual([
        "cheap-model",
        meta,
        [
          {
            kind: EPartKind.TEXT,
            text: "user: text 2\nuser: text 3",
          },
        ],
        {
          summary: "The user wants a refund for invoice 4521.",
          facts: {invoiceId: "4521"},
          updatedAtTurn: 4,
        },
      ]);
    });

    test("not due yet: nothing is called while the thread grew by less than updateEveryTurns", async () => {
      const context = await setup({
        enabled: true,
        strategy: {
          type: EWorkingMemoryStrategy.SUMMARY_BUFFER,
          updateEveryTurns: 6,
        },
      });
      await appendTurns(context, 4);
      await saveContext(context);
      expect(context.llmClient.completeCalls.length).toBe(0);
    });

    test("a long gap sends the latest 20 turns only, and the memory counts as updated up to now", async () => {
      const context = await setup();
      await appendTurns(context, 30);
      enqueue(context.llmClient, answer);
      await saveContext(context);
      const [part] = context.llmClient.completeCalls[0].request.messages[0].parts;
      expect([
        part.kind === EPartKind.TEXT ? part.text.split("\n").length : 0,
        part.kind === EPartKind.TEXT ? part.text.startsWith("user: text 10\n") : false,
        (await context.memory.getState(address(context.threadId))).updatedAtTurn,
      ]).toEqual([20, true, 30]);
    });

    test("the profile's SUMMARY_BUFFER options apply: maxSummaryChars and maxFacts", async () => {
      const context = await setup();
      await appendTurns(context, 2);
      enqueue(context.llmClient, {
        summary: "0123456789 and more",
        facts: ["a", "b", "c"].map(key => ({
          key,
          value: key.toUpperCase(),
        })),
      });
      await saveContext(context, makeProfile({
        type: EWorkingMemoryStrategy.SUMMARY_BUFFER,
        maxSummaryChars: 10,
        maxFacts: 2,
      }));
      expect(await context.memory.getState(address(context.threadId))).toMatchObject({
        summary: "0123456789",
        facts: {
          a: "A",
          b: "B",
        },
      });
    });

    test("SLIDING_WINDOW: nothing is called, nothing is stored", async () => {
      const context = await setup({
        enabled: true,
        strategy: {type: EWorkingMemoryStrategy.SLIDING_WINDOW},
      });
      await appendTurns(context, 4);
      await saveContext(context);
      expect([context.llmClient.completeCalls.length, (await context.memory.getState(address(context.threadId))).updatedAtTurn]).toEqual([0, 0]);
    });

    test("switched off: nothing is called", async () => {
      const context = await setup({enabled: false});
      await appendTurns(context, 4);
      await saveContext(context);
      expect(context.llmClient.completeCalls.length).toBe(0);
    });

    test("a failing model call keeps the old state, is reported once and does not throw", async () => {
      const context = await setup();
      const report = silence();
      await appendTurns(context, 2);
      await context.threadStore.setWorkingMemory({
        ...address(context.threadId),
        state: makeState({updatedAtTurn: 0}),
      });
      // Nothing is enqueued: the FakeLLMClient throws
      await saveContext(context);
      expect([await context.memory.getState(address(context.threadId)), report.mock.calls.length]).toEqual([makeState({updatedAtTurn: 0}), 1]);
    });

    test("an unknown thread is reported, not thrown", async () => {
      const context = await setup();
      const report = silence();
      await context.memory.saveContext({
        ...address("missing"),
        userId: "user-a",
        profile: makeProfile(),
        request,
        result,
        cheapModelId: "cheap-model",
        meta,
      });
      expect(report.mock.calls.length).toBe(1);
    });
  });

  describe("getState", () => {
    test("returns the empty state for a new thread", async () => {
      const {
        memory,
        threadId,
      } = await setup();
      expect(await memory.getState(address(threadId))).toEqual({
        summary: "",
        facts: {},
        updatedAtTurn: 0,
      });
    });

    test("returns the state stored on the thread", async () => {
      const {
        memory,
        threadStore,
        threadId,
      } = await setup();
      await threadStore.setWorkingMemory({
        ...address(threadId),
        state: makeState(),
      });
      expect(await memory.getState(address(threadId))).toEqual(makeState());
    });

    test("an unknown thread is a 404", async () => {
      const {memory} = await setup();
      await expect(memory.getState(address("missing"))).rejects.toMatchObject({status: 404});
    });
  });

  describe("M4 — reset", () => {
    test("clears the summary and the facts", async () => {
      const context = await setup();
      const {
        memory,
        threadStore,
        threadId,
      } = context;
      await threadStore.setWorkingMemory({
        ...address(threadId),
        state: makeState(),
      });
      await memory.reset(address(threadId));
      expect(await memory.getState(address(threadId))).toMatchObject({
        summary: "",
        facts: {},
      });
    });

    test("the turns so far count as seen: no update runs right after a reset", async () => {
      const context = await setup();
      const {
        memory,
        threadStore,
        threadId,
        llmClient,
      } = context;
      await appendTurns(context, 4);
      await memory.reset(address(threadId));
      await memory.saveContext({
        ...address(threadId),
        userId: "user-a",
        profile: makeProfile(),
        cheapModelId: "cheap-model",
        meta,
      });
      const thread = await threadStore.getThread(address(threadId));
      expect([thread.workingMemory.updatedAtTurn, llmClient.completeCalls.length]).toEqual([4, 0]);
    });

    test("an unknown thread is a 404", async () => {
      const {memory} = await setup();
      await expect(memory.reset(address("missing"))).rejects.toMatchObject({status: 404});
    });
  });
});
