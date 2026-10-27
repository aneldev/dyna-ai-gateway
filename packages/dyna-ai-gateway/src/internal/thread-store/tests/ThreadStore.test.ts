import {InMemoryThreadRepository} from "../../../adapters/in-memory";
import {
  ITurn,
  EPartKind,
  ETurnRole,
} from "../../../contracts";

import {ThreadStore} from "../ThreadStore";
import {
  IThread,
  EThreadStatus,
} from "../types";

const makeTurn = (text: string): ITurn => ({
  id: `turn-${text}`,
  role: ETurnRole.USER,
  parts: [
    {
      kind: EPartKind.TEXT,
      text,
    },
  ],
  createdAt: new Date(1_000),
});

interface ISetup {
  repository: InMemoryThreadRepository;
  store: ThreadStore;
}

const setup = (): ISetup => {
  const repository = new InMemoryThreadRepository();
  return {
    repository,
    store: new ThreadStore({repository}),
  };
};

const createThread = (store: ThreadStore, title?: string): Promise<IThread> =>
  store.createThread({
    tenantId: "tenant-a",
    userId: "user-a",
    title,
  });

const appendTexts = async (store: ThreadStore, threadId: string, texts: string[]): Promise<void> => {
  for (const text of texts) {
    await store.appendTurn({
      tenantId: "tenant-a",
      threadId,
      turn: makeTurn(text),
    });
  }
};

describe("ThreadStore", () => {
  describe("M1", () => {
    test("createThread returns an OPEN thread with empty working memory and no turns", async () => {
      const {store} = setup();
      const thread = await createThread(store, "My thread");
      expect(thread).toMatchObject({
        tenantId: "tenant-a",
        userId: "user-a",
        title: "My thread",
        status: EThreadStatus.OPEN,
        workingMemory: {
          summary: "",
          facts: {},
          updatedAtTurn: 0,
        },
        turnCount: 0,
      });
    });

    test("createThread gives every thread its own id", async () => {
      const {store} = setup();
      const [first, second] = [await createThread(store), await createThread(store)];
      expect(first.id).not.toBe(second.id);
    });

    test("createThread defaults the title to an empty string", async () => {
      const {store} = setup();
      expect((await createThread(store)).title).toBe("");
    });

    test("getThread returns the created thread", async () => {
      const {store} = setup();
      const created = await createThread(store);
      expect(await store.getThread({
        tenantId: "tenant-a",
        threadId: created.id,
      })).toEqual(created);
    });

    test("getThread throws a 404 with code 5372567786151 for an unknown thread", async () => {
      const {store} = setup();
      await expect(store.getThread({
        tenantId: "tenant-a",
        threadId: "missing",
      })).rejects.toMatchObject({
        code: 5372567786151,
        status: 404,
        data: {
          tenantId: "tenant-a",
          threadId: "missing",
        },
      });
    });

    test("getThread does not return a thread of another tenant", async () => {
      const {store} = setup();
      const created = await createThread(store);
      await expect(store.getThread({
        tenantId: "tenant-b",
        threadId: created.id,
      })).rejects.toMatchObject({code: 5372567786151});
    });

    test("getThread treats a soft-deleted thread as unknown", async () => {
      const {
        repository,
        store,
      } = setup();
      const created = await createThread(store);
      await repository.saveThread({
        thread: {
          ...created,
          deletedAt: new Date(2_000),
        },
      });
      await expect(store.getThread({
        tenantId: "tenant-a",
        threadId: created.id,
      })).rejects.toMatchObject({code: 5372567786151});
    });

    test("appendTurn bumps turnCount and updatedAt", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(10_000);
      const {store} = setup();
      const created = await createThread(store);
      jest.setSystemTime(20_000);
      await appendTexts(store, created.id, ["hello", "again"]);
      const thread = await store.getThread({
        tenantId: "tenant-a",
        threadId: created.id,
      });
      expect([thread.turnCount, thread.updatedAt.getTime()]).toEqual([2, 20_000]);
      jest.useRealTimers();
    });

    test("appendTurn throws for an unknown thread", async () => {
      const {store} = setup();
      await expect(store.appendTurn({
        tenantId: "tenant-a",
        threadId: "missing",
        turn: makeTurn("hello"),
      })).rejects.toMatchObject({code: 5372567786151});
    });

    test("getLastTurns returns the last N turns in chronological order", async () => {
      const {store} = setup();
      const created = await createThread(store);
      await appendTexts(store, created.id, ["one", "two", "three", "four"]);
      const turns = await store.getLastTurns({
        tenantId: "tenant-a",
        threadId: created.id,
        limit: 3,
      });
      expect(turns.map(turn => turn.id)).toEqual(["turn-two", "turn-three", "turn-four"]);
    });

    test("getLastTurns returns the stored turns as appended", async () => {
      const {store} = setup();
      const created = await createThread(store);
      await appendTexts(store, created.id, ["one"]);
      expect(await store.getLastTurns({
        tenantId: "tenant-a",
        threadId: created.id,
        limit: 10,
      })).toEqual([makeTurn("one")]);
    });

    test("getLastTurns throws for a thread of another tenant", async () => {
      const {store} = setup();
      const created = await createThread(store);
      await expect(store.getLastTurns({
        tenantId: "tenant-b",
        threadId: created.id,
        limit: 10,
      })).rejects.toMatchObject({code: 5372567786151});
    });
  });

  describe("M2", () => {
    test("updateThread changes the status and keeps the title", async () => {
      const {store} = setup();
      const created = await createThread(store, "My thread");
      await store.updateThread({
        tenantId: "tenant-a",
        threadId: created.id,
        status: EThreadStatus.AWAITING_HUMAN,
      });
      const thread = await store.getThread({
        tenantId: "tenant-a",
        threadId: created.id,
      });
      expect([thread.status, thread.title]).toEqual([EThreadStatus.AWAITING_HUMAN, "My thread"]);
    });

    test("updateThread changes the title and keeps the status", async () => {
      const {store} = setup();
      const created = await createThread(store, "Old");
      await store.updateThread({
        tenantId: "tenant-a",
        threadId: created.id,
        title: "New",
      });
      const thread = await store.getThread({
        tenantId: "tenant-a",
        threadId: created.id,
      });
      expect([thread.title, thread.status]).toEqual(["New", EThreadStatus.OPEN]);
    });

    test("updateThread bumps updatedAt", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(10_000);
      const {store} = setup();
      const created = await createThread(store);
      jest.setSystemTime(20_000);
      await store.updateThread({
        tenantId: "tenant-a",
        threadId: created.id,
        title: "New",
      });
      expect((await store.getThread({
        tenantId: "tenant-a",
        threadId: created.id,
      })).updatedAt).toEqual(new Date(20_000));
      jest.useRealTimers();
    });

    test("updateThread throws the 404 of getThread for an unknown thread", async () => {
      const {store} = setup();
      await expect(store.updateThread({
        tenantId: "tenant-a",
        threadId: "missing",
        title: "New",
      })).rejects.toMatchObject({status: 404});
    });
  });

  describe("M4 — setWorkingMemory", () => {
    const state = {
      summary: "The user asks about invoice 4521.",
      facts: {role: "accountant"},
      updatedAtTurn: 2,
    };

    test("stores the state on the thread", async () => {
      const {store} = setup();
      const thread = await createThread(store);
      await store.setWorkingMemory({
        tenantId: "tenant-a",
        threadId: thread.id,
        state,
      });
      expect((await store.getThread({
        tenantId: "tenant-a",
        threadId: thread.id,
      })).workingMemory).toEqual(state);
    });

    test("leaves the rest of the thread as it is, updatedAt included", async () => {
      const {store} = setup();
      const thread = await createThread(store, "Invoices");
      await appendTexts(store, thread.id, ["one", "two"]);
      const before = await store.getThread({
        tenantId: "tenant-a",
        threadId: thread.id,
      });
      await store.setWorkingMemory({
        tenantId: "tenant-a",
        threadId: thread.id,
        state,
      });
      expect(await store.getThread({
        tenantId: "tenant-a",
        threadId: thread.id,
      })).toEqual({
        ...before,
        workingMemory: state,
      });
    });

    test("a later change of the given state does not reach the stored one", async () => {
      const {store} = setup();
      const thread = await createThread(store);
      const given = structuredClone(state);
      await store.setWorkingMemory({
        tenantId: "tenant-a",
        threadId: thread.id,
        state: given,
      });
      given.facts.role = "changed";
      expect((await store.getThread({
        tenantId: "tenant-a",
        threadId: thread.id,
      })).workingMemory.facts).toEqual({role: "accountant"});
    });

    test("an unknown thread is a 404", async () => {
      const {store} = setup();
      await expect(store.setWorkingMemory({
        tenantId: "tenant-a",
        threadId: "missing",
        state,
      })).rejects.toMatchObject({status: 404});
    });

    test("the thread of another tenant is a 404", async () => {
      const {store} = setup();
      const thread = await createThread(store);
      await expect(store.setWorkingMemory({
        tenantId: "tenant-b",
        threadId: thread.id,
        state,
      })).rejects.toMatchObject({status: 404});
    });
  });
});
