import {
  IThread,
  EThreadStatus,
} from "../../../internal/thread-store";

import {InMemoryThreadRepository} from "../InMemoryThreadRepository";

const makeThread = (threadId: string, userId: string): IThread => ({
  id: threadId,
  tenantId: "tenant-a",
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

/** A cursor must be a listed thread of the user (D37): another user's thread, like an unknown id, is a 404 that tells nothing about it. */
test("listThreads with a cursor that is not a thread of the user is a 404", async () => {
  const repository = new InMemoryThreadRepository();
  await repository.saveThread({thread: makeThread("thread-a", "user-a")});
  await repository.saveThread({thread: makeThread("thread-b", "user-b")});

  await expect(repository.listThreads({
    tenantId: "tenant-a",
    userId: "user-a",
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: "thread-b",
    },
  })).rejects.toMatchObject({
    code: 5379462948293,
    status: 404,
  });
});
