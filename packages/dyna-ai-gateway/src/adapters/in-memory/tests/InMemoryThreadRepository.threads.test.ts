import {
  ITurn,
  ETurnRole,
} from "../../../contracts";
import {
  IThread,
  EThreadStatus,
} from "../../../internal/thread-store";

import {InMemoryThreadRepository} from "../InMemoryThreadRepository";

const makeThread = (tenantId: string, threadId: string, userId = "user-a"): IThread => ({
  id: threadId,
  tenantId,
  userId,
  title: `Thread ${threadId}`,
  status: EThreadStatus.OPEN,
  workingMemory: {
    summary: "",
    facts: {},
    updatedAtTurn: 0,
  },
  turnCount: 0,
  lease: null,
  createdAt: new Date(1_000),
  updatedAt: new Date(1_000),
  deletedAt: null,
});

const saveThreads = async (repository: InMemoryThreadRepository, threads: IThread[]): Promise<void> => {
  for (const thread of threads) await repository.saveThread({thread});
};

const firstPage = {
  limit: 10,
  startingAfter: null,
  endingBefore: null,
};

describe("InMemoryThreadRepository — threads", () => {
  test("loadThread returns the saved thread", async () => {
    const repository = new InMemoryThreadRepository();
    await saveThreads(repository, [makeThread("tenant-a", "thread-1")]);
    expect(await repository.loadThread({
      tenantId: "tenant-a",
      threadId: "thread-1",
    })).toEqual(makeThread("tenant-a", "thread-1"));
  });

  test("loadThread returns null when the thread does not exist", async () => {
    const repository = new InMemoryThreadRepository();
    expect(await repository.loadThread({
      tenantId: "tenant-a",
      threadId: "missing",
    })).toBeNull();
  });

  test("loadThread returns null for a thread of another tenant", async () => {
    const repository = new InMemoryThreadRepository();
    await saveThreads(repository, [makeThread("tenant-a", "thread-1")]);
    expect(await repository.loadThread({
      tenantId: "tenant-b",
      threadId: "thread-1",
    })).toBeNull();
  });

  test("saveThread replaces the thread with the same threadId", async () => {
    const repository = new InMemoryThreadRepository();
    await saveThreads(repository, [makeThread("tenant-a", "thread-1")]);
    await saveThreads(repository, [{
      ...makeThread("tenant-a", "thread-1"),
      title: "Renamed",
    }]);
    const thread = await repository.loadThread({
      tenantId: "tenant-a",
      threadId: "thread-1",
    });
    expect(thread?.title).toBe("Renamed");
  });

  test("listThreads returns only the threads of that tenant and user", async () => {
    const repository = new InMemoryThreadRepository();
    await saveThreads(repository, [
      makeThread("tenant-a", "thread-1", "user-a"),
      makeThread("tenant-a", "thread-2", "user-b"),
      makeThread("tenant-b", "thread-3", "user-a"),
    ]);
    const {items} = await repository.listThreads({
      tenantId: "tenant-a",
      userId: "user-a",
      page: firstPage,
    });
    expect(items.map(thread => thread.id)).toEqual(["thread-1"]);
  });

  test("listThreads leaves a soft-deleted thread out", async () => {
    const repository = new InMemoryThreadRepository();
    await saveThreads(repository, [
      makeThread("tenant-a", "thread-1"),
      {
        ...makeThread("tenant-a", "thread-2"),
        deletedAt: new Date(2_000),
      },
    ]);
    const {items} = await repository.listThreads({
      tenantId: "tenant-a",
      userId: "user-a",
      page: firstPage,
    });
    expect(items.map(thread => thread.id)).toEqual(["thread-1"]);
  });

  describe("by user (GDPR)", () => {
    const owner = {
      tenantId: "tenant-a",
      userId: "user-a",
    };
    const makeTurn = (id: string): ITurn => ({
      id,
      role: ETurnRole.USER,
      parts: [],
      createdAt: new Date(1_000),
    });
    /** User-a has two threads in tenant-a with three turns; user-b and tenant-b have one thread each. */
    const seed = async (): Promise<InMemoryThreadRepository> => {
      const repository = new InMemoryThreadRepository();
      await saveThreads(repository, [
        makeThread("tenant-a", "thread-1"),
        makeThread("tenant-a", "thread-2"),
        makeThread("tenant-a", "thread-3", "user-b"),
        makeThread("tenant-b", "thread-4"),
      ]);
      for (const [threadId, turnId] of [["thread-1", "turn-1"], ["thread-1", "turn-2"], ["thread-2", "turn-3"], ["thread-3", "turn-4"]]) {
        await repository.appendTurn({
          tenantId: "tenant-a",
          threadId,
          turn: makeTurn(turnId),
        });
      }
      return repository;
    };
    const loadIds = async (repository: InMemoryThreadRepository, tenantId: string, userId: string): Promise<string[]> =>
      (await repository.listThreads({
        tenantId,
        userId,
        page: firstPage,
      })).items.map(thread => thread.id);

    test("delete all of a user removes the user's threads and turns and counts them", async () => {
      const repository = await seed();
      expect(await repository.delete({
        ...owner,
        threadIds: "all",
      })).toEqual({
        threads: 2,
        turns: 3,
      });
      expect(await loadIds(repository, "tenant-a", "user-a")).toEqual([]);
      expect(await repository.loadTurns({
        tenantId: "tenant-a",
        threadId: "thread-1",
        desc: false,
        skip: 0,
        limit: 10,
      })).toEqual([]);
    });

    test("delete all of a user leaves another user of the tenant and the same user of another tenant untouched", async () => {
      const repository = await seed();
      await repository.delete({
        ...owner,
        threadIds: "all",
      });
      expect([await loadIds(repository, "tenant-a", "user-b"), await loadIds(repository, "tenant-b", "user-a")])
        .toEqual([["thread-3"], ["thread-4"]]);
    });

    test("anonymizeByUser keeps the skeleton under the pseudonym, closed, without title, memory or turns", async () => {
      const repository = await seed();
      await repository.saveThread({
        thread: {
          ...makeThread("tenant-a", "thread-1"),
          turnCount: 2,
          workingMemory: {
            summary: "The user is Dennis",
            facts: {name: "Dennis"},
            updatedAtTurn: 2,
          },
        },
      });
      expect(await repository.anonymizeByUser({
        ...owner,
        pseudonym: "@anon-1",
      })).toEqual({
        threads: 2,
        turns: 3,
      });
      expect(await repository.loadThread({
        tenantId: "tenant-a",
        threadId: "thread-1",
      })).toEqual({
        ...makeThread("tenant-a", "thread-1", "@anon-1"),
        title: "",
        status: EThreadStatus.CLOSED,
        turnCount: 2,
      });
      // Newest first, the id breaks the tie of one createdAt (D37)
      expect([await loadIds(repository, "tenant-a", "user-a"), await loadIds(repository, "tenant-a", "@anon-1")])
        .toEqual([[], ["thread-2", "thread-1"]]);
    });
  });
});
