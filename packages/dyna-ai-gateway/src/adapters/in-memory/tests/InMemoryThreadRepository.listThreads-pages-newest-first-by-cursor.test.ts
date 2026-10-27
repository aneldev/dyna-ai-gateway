import {
  IThread,
  EThreadStatus,
} from "../../../internal/thread-store";

import {InMemoryThreadRepository} from "../InMemoryThreadRepository";

const makeThread = (threadId: string, createdAtMs: number): IThread => ({
  id: threadId,
  tenantId: "tenant-a",
  userId: "user-a",
  title: `Thread ${threadId}`,
  status: EThreadStatus.OPEN,
  workingMemory: {
    summary: "",
    facts: {},
    updatedAtTurn: 0,
  },
  turnCount: 0,
  lease: null,
  createdAt: new Date(createdAtMs),
  updatedAt: new Date(createdAtMs),
  deletedAt: null,
});

const listIds = async (
  repository: InMemoryThreadRepository,
  page: {startingAfter: string | null; endingBefore: string | null},
): Promise<[string[], boolean]> => {
  const {
    items,
    hasMore,
  } = await repository.listThreads({
    tenantId: "tenant-a",
    userId: "user-a",
    page: {
      limit: 2,
      ...page,
    },
  });
  return [items.map(thread => thread.id), hasMore];
};

/**
 * The thread list pages as the Vercel chat client does (D37): newest `createdAt` first, the id as the tie-break; `endingBefore`
 * reads the older page next to the cursor, `startingAfter` the newer page next to the cursor; `hasMore` says whether the list
 * goes on in the direction of the read. Threads "b" and "c" share a millisecond, so the order between them is by id.
 */
test("listThreads pages newest first by cursor, with the id as the tie-break", async () => {
  const repository = new InMemoryThreadRepository();
  for (const thread of [makeThread("a", 1_000), makeThread("c", 2_000), makeThread("b", 2_000), makeThread("d", 3_000), makeThread("e", 4_000)]) {
    await repository.saveThread({thread});
  }

  expect([
    await listIds(repository, {
      startingAfter: null,
      endingBefore: null,
    }),
    await listIds(repository, {
      startingAfter: null,
      endingBefore: "d",
    }),
    await listIds(repository, {
      startingAfter: null,
      endingBefore: "b",
    }),
    await listIds(repository, {
      startingAfter: "a",
      endingBefore: null,
    }),
    await listIds(repository, {
      startingAfter: "d",
      endingBefore: null,
    }),
  ]).toEqual([
    [["e", "d"], true],
    [["c", "b"], true],
    [["a"], false],
    [["c", "b"], true],
    [["e"], false],
  ]);
});
