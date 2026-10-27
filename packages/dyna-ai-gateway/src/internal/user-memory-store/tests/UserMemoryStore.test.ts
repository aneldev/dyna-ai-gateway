import {
  InMemoryPromptTemplateRepository,
  InMemoryUserMemoryRepository,
} from "../../../adapters/in-memory";
import {
  ITurn,
  EPartKind,
  ETurnRole,
} from "../../../contracts";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {
  ILLMClientCallMeta,
  EFinishReason,
  EMessageRole,
} from "../../llm-client";
import {PromptTemplateStore} from "../../prompt-template-store";
import {ETraceKind} from "../../trace";

import {UserMemoryStore} from "../UserMemoryStore";
import {
  IUserMemoryStoreConfig,
  EUserMemoryFactOp,
} from "../types";

interface ISetup {
  store: UserMemoryStore;
  repository: InMemoryUserMemoryRepository;
  llmClient: FakeLLMClient;
}

const setup = (config: Partial<IUserMemoryStoreConfig> = {}): ISetup => {
  const repository = new InMemoryUserMemoryRepository();
  const llmClient = new FakeLLMClient();
  return {
    repository,
    llmClient,
    store: new UserMemoryStore({
      repository,
      enabled: true,
      ...config,
    }, {
      llmClient,
      promptTemplateStore: new PromptTemplateStore({repository: new InMemoryPromptTemplateRepository()}),
    }),
  };
};

const owner = {
  tenantId: "tenant-a",
  userId: "user-a",
};

const getPairs = async (store: UserMemoryStore, of = owner): Promise<Array<[string, string]>> =>
  (await store.getFacts(of)).map(fact => [fact.key, fact.value]);

describe("UserMemoryStore", () => {
  afterEach(() => jest.useRealTimers());

  describe("M4 — getFacts and upsertFact", () => {
    test("a user without facts has an empty list", async () => {
      const {store} = setup();
      expect(await store.getFacts(owner)).toEqual([]);
    });

    test("upsertFact adds a fact, entered by hand: no source thread, updated now", async () => {
      jest.useFakeTimers({now: new Date("2026-10-01T10:00:00Z")});
      const {store} = setup();
      await store.upsertFact({
        ...owner,
        key: "language",
        value: "German",
      });
      expect(await store.getFacts(owner)).toEqual([
        {
          key: "language",
          value: "German",
          updatedAt: new Date("2026-10-01T10:00:00Z"),
        },
      ]);
    });

    test("the same key replaces the fact", async () => {
      const {store} = setup();
      for (const value of ["German", "Greek"]) {
        await store.upsertFact({
          ...owner,
          key: "language",
          value,
        });
      }
      expect(await getPairs(store)).toEqual([["language", "Greek"]]);
    });

    test("key and value are trimmed", async () => {
      const {store} = setup();
      await store.upsertFact({
        ...owner,
        key: " role ",
        value: " accountant ",
      });
      expect(await getPairs(store)).toEqual([["role", "accountant"]]);
    });

    test.each([["", "x"], ["role", "  "]])("an empty key or value is a 400 (key [%s], value [%s])", async (key, value) => {
      const {store} = setup();
      await expect(store.upsertFact({
        ...owner,
        key,
        value,
      })).rejects.toMatchObject({
        code: 5372597957094,
        status: 400,
      });
    });

    test("over maxFacts the fact that was updated longest ago is dropped", async () => {
      jest.useFakeTimers({now: new Date("2026-10-01T10:00:00Z")});
      const {store} = setup({maxFacts: 2});
      for (const key of ["first", "second", "third"]) {
        await store.upsertFact({
          ...owner,
          key,
          value: "x",
        });
        jest.advanceTimersByTime(1_000);
      }
      expect((await getPairs(store)).map(([key]) => key).sort()).toEqual(["second", "third"]);
    });

    test("facts belong to one user of one tenant", async () => {
      const {store} = setup();
      await store.upsertFact({
        ...owner,
        key: "language",
        value: "German",
      });
      expect([
        await getPairs(store, {
          tenantId: "tenant-a",
          userId: "user-b",
        }),
        await getPairs(store, {
          tenantId: "tenant-b",
          userId: "user-a",
        }),
      ]).toEqual([[], []]);
    });
  });

  describe("M4 — removeFact and clear", () => {
    const fill = async (store: UserMemoryStore): Promise<void> => {
      for (const key of ["language", "role"]) {
        await store.upsertFact({
          ...owner,
          key,
          value: "x",
        });
      }
    };

    test("removeFact removes the fact with the key", async () => {
      const {store} = setup();
      await fill(store);
      await store.removeFact({
        ...owner,
        key: "language",
      });
      expect(await getPairs(store)).toEqual([["role", "x"]]);
    });

    test("removeFact with a key that is not there changes nothing and does not save", async () => {
      const {
        store,
        repository,
      } = setup();
      await fill(store);
      const saveAll = jest.spyOn(repository, "saveAll");
      await store.removeFact({
        ...owner,
        key: "missing",
      });
      expect([(await getPairs(store)).length, saveAll.mock.calls.length]).toEqual([2, 0]);
    });

    test("clear removes every fact of the user", async () => {
      const {store} = setup();
      await fill(store);
      await store.clear(owner);
      expect(await store.getFacts(owner)).toEqual([]);
    });

    test("clear leaves the facts of another user", async () => {
      const {store} = setup();
      const other = {
        tenantId: "tenant-a",
        userId: "user-b",
      };
      await store.upsertFact({
        ...other,
        key: "language",
        value: "Greek",
      });
      await store.clear(owner);
      expect(await getPairs(store, other)).toEqual([["language", "Greek"]]);
    });
  });

  describe("M4 — isExtractDue", () => {
    const isDue = (store: UserMemoryStore, previousTurnCount: number, turnCount: number): boolean =>
      store.isExtractDue({
        turnCount,
        previousTurnCount,
      });

    test("due when the thread reached or passed a multiple of extractEveryTurns with its last call", () => {
      const {store} = setup({extractEveryTurns: 10});
      expect([isDue(store, 6, 8), isDue(store, 8, 10), isDue(store, 9, 12), isDue(store, 10, 12), isDue(store, 18, 21)])
        .toEqual([false, true, true, false, true]);
    });

    test("due after the first answer of a thread, whatever extractEveryTurns is", () => {
      const {store} = setup({extractEveryTurns: 10});
      expect([isDue(store, 0, 2), isDue(store, 0, 0), isDue(store, 2, 4)]).toEqual([true, false, false]);
    });

    test("the default is every 10 turns", () => {
      const {store} = setup();
      expect([isDue(store, 7, 9), isDue(store, 9, 11)]).toEqual([false, true]);
    });

    test("nothing is due while the extraction is switched off", () => {
      const {store} = setup({
        enabled: false,
        extractEveryTurns: 2,
      });
      expect(isDue(store, 0, 50)).toBe(false);
    });
  });

  describe("M4 — extract", () => {
    const meta: ILLMClientCallMeta = {
      tenantId: "tenant-a",
      userId: "user-a",
      threadId: "thread-1",
      kind: ETraceKind.MEMORY_USER,
    };

    const turns: ITurn[] = [
      {
        id: "turn-1",
        role: ETurnRole.USER,
        parts: [
          {
            kind: EPartKind.TEXT,
            text: "I am an accountant, answer in German please",
          },
        ],
        createdAt: new Date(1_000),
      },
    ];

    /** The model's answer: SET for every entry of `record`, DELETE for every key of `forget`. */
    const toFacts = (record: Record<string, string>, forget: string[] = []): {facts: Array<{key: string; value: string; op: EUserMemoryFactOp}>} => ({
      facts: [
        ...Object.entries(record).map(([key, value]) => ({
          key,
          value,
          op: EUserMemoryFactOp.SET,
        })),
        ...forget.map(key => ({
          key,
          value: "",
          op: EUserMemoryFactOp.DELETE,
        })),
      ],
    });

    /** The model answers with `structured`; then the facts are extracted from `turns`. */
    const extract = (
      {
        store,
        llmClient,
      }: ISetup,
      structured: unknown,
      extractTurns: ITurn[] = turns,
    ): ReturnType<UserMemoryStore["extract"]> => {
      llmClient.enqueueComplete({
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
      }, ETraceKind.MEMORY_USER);
      return store.extract({
        ...owner,
        threadId: "thread-1",
        turns: extractTurns,
        cheapModelId: "cheap-model",
        meta,
      });
    };

    const silence = (): jest.SpyInstance => jest.spyOn(console, "error").mockImplementation(() => undefined);
    afterEach(() => jest.restoreAllMocks());

    test("stores the extracted facts with the thread they came from", async () => {
      jest.useFakeTimers({now: new Date("2026-10-01T10:00:00Z")});
      const context = setup();
      await extract(context, toFacts({role: "accountant"}));
      expect(await context.store.getFacts(owner)).toEqual([
        {
          key: "role",
          value: "accountant",
          sourceThreadId: "thread-1",
          updatedAt: new Date("2026-10-01T10:00:00Z"),
        },
      ]);
    });

    test("returns the facts that are stored afterwards", async () => {
      const context = setup();
      await context.store.upsertFact({
        ...owner,
        key: "language",
        value: "German",
      });
      const facts = await extract(context, toFacts({role: "accountant"}));
      expect([facts, facts.map(fact => fact.key)]).toEqual([await context.store.getFacts(owner), ["language", "role"]]);
    });

    test("an extracted fact replaces the known fact with the same key", async () => {
      const context = setup();
      await context.store.upsertFact({
        ...owner,
        key: "language",
        value: "German",
      });
      await extract(context, toFacts({language: "Greek"}));
      expect((await context.store.getFacts(owner)).map(fact => [fact.key, fact.value, fact.sourceThreadId])).toEqual([["language", "Greek", "thread-1"]]);
    });

    test("a known fact the model repeats unchanged keeps its date and its source", async () => {
      jest.useFakeTimers({now: new Date("2026-10-01T10:00:00Z")});
      const context = setup();
      await context.store.upsertFact({
        ...owner,
        key: "language",
        value: "German",
      });
      jest.advanceTimersByTime(60_000);
      await extract(context, toFacts({language: " German "}));
      expect(await context.store.getFacts(owner)).toEqual([
        {
          key: "language",
          value: "German",
          updatedAt: new Date("2026-10-01T10:00:00Z"),
        },
      ]);
    });

    test("a DELETE removes the known fact with the key; the user retracted it", async () => {
      const context = setup();
      for (const [key, value] of [["language", "German"], ["role", "accountant"]]) {
        await context.store.upsertFact({
          ...owner,
          key,
          value,
        });
      }
      await extract(context, toFacts({}, ["language"]));
      expect(await getPairs(context.store)).toEqual([["role", "accountant"]]);
    });

    test("a DELETE of a key that is not there changes nothing", async () => {
      const context = setup();
      await context.store.upsertFact({
        ...owner,
        key: "role",
        value: "accountant",
      });
      await extract(context, toFacts({}, ["language"]));
      expect(await getPairs(context.store)).toEqual([["role", "accountant"]]);
    });

    test("a DELETE wins over a SET of the same key in the same answer when it comes later", async () => {
      const context = setup();
      await extract(context, toFacts({language: "German"}, ["language"]));
      expect(await getPairs(context.store)).toEqual([]);
    });

    test("an answer without op is not the expected structure and keeps the stored facts", async () => {
      const context = setup();
      silence();
      await context.store.upsertFact({
        ...owner,
        key: "language",
        value: "German",
      });
      await extract(context, {
        facts: [{
          key: "role",
          value: "accountant",
        }],
      });
      expect(await getPairs(context.store)).toEqual([["language", "German"]]);
    });

    test("facts without a key or without a value are dropped", async () => {
      const context = setup();
      await extract(context, toFacts({
        " ": "x",
        empty: "",
        role: " accountant ",
      }));
      expect(await getPairs(context.store)).toEqual([["role", "accountant"]]);
    });

    test("over maxFacts the facts updated longest ago are dropped", async () => {
      jest.useFakeTimers({now: new Date("2026-10-01T10:00:00Z")});
      const context = setup({maxFacts: 2});
      await context.store.upsertFact({
        ...owner,
        key: "old",
        value: "x",
      });
      jest.advanceTimersByTime(1_000);
      await extract(context, toFacts({
        role: "accountant",
        language: "German",
      }));
      expect((await getPairs(context.store)).map(([key]) => key).sort()).toEqual(["language", "role"]);
    });

    test("calls the cheap model with the meta of the caller and asks for a structured answer", async () => {
      const context = setup();
      await extract(context, toFacts({}));
      const [call] = context.llmClient.completeCalls;
      expect([call.request.modelId, call.meta, Boolean(call.request.outputSchema)]).toEqual(["cheap-model", meta, true]);
    });

    test("the system prompt carries the known facts and the cap; the turns go in as one transcript message", async () => {
      const context = setup({maxFacts: 7});
      await context.store.upsertFact({
        ...owner,
        key: "language",
        value: "German",
      });
      await extract(context, toFacts({}));
      const {request} = context.llmClient.completeCalls[0];
      expect([request.system.includes("language: German"), request.system.includes("at most 7 facts"), request.messages]).toEqual([
        true,
        true,
        [
          {
            role: EMessageRole.USER,
            parts: [
              {
                kind: EPartKind.TEXT,
                text: "user: I am an accountant, answer in German please",
              },
            ],
          },
        ],
      ]);
    });

    test.each([
      ["no structured answer", undefined],
      ["an answer of another structure", {facts: {role: "accountant"}}],
    ])("%s keeps the stored facts and is reported with its code", async (_name, structured) => {
      const context = setup();
      const report = silence();
      await context.store.upsertFact({
        ...owner,
        key: "language",
        value: "German",
      });
      const facts = await extract(context, structured);
      expect([facts.map(fact => fact.key), String(report.mock.calls[0][0]).startsWith("Internal error 5372598726369: ")]).toEqual([["language"], true]);
    });

    test("a model call that fails keeps the stored facts, does not throw and is reported with its code", async () => {
      const context = setup();
      const report = silence();
      // Nothing is enqueued: the FakeLLMClient throws
      const facts = await context.store.extract({
        ...owner,
        threadId: "thread-1",
        turns,
        cheapModelId: "cheap-model",
        meta,
      });
      expect([facts, String(report.mock.calls[0][0]).startsWith("Internal error 5372598726156: ")]).toEqual([[], true]);
    });

    test("without turns the model is not called", async () => {
      const context = setup();
      await extract(context, toFacts({role: "accountant"}), []);
      expect([context.llmClient.completeCalls.length, await context.store.getFacts(owner)]).toEqual([0, []]);
    });

    test("switched off, the model is not called and the facts stay", async () => {
      const context = setup({enabled: false});
      await extract(context, toFacts({role: "accountant"}));
      expect([context.llmClient.completeCalls.length, await context.store.getFacts(owner)]).toEqual([0, []]);
    });
  });
});
