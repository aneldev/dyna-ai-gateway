import {
  IThread,
  AIGateway,
  EThreadStatus,
} from "../..";

import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigThreads,
  threadsRepository,
} from "./threads.config";

const makeThread = (threadId: string, createdAtMs: number): IThread => ({
  id: threadId,
  tenantId: sampleUserContext.tenantId,
  userId: sampleUserContext.userId,
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

/**
 * The sidebar of a chat screen (D37): `listThreads` pages the calling user's threads newest first, as the Vercel chat client
 * pages its chats — the first read with both cursors null, the next page with `endingBefore` the last id shown, `hasMore`
 * when the list goes on. The threads are seeded with their dates, since three threads made in one millisecond have no order.
 */
test("listThreads pages the user's threads newest first, the next page by endingBefore", async () => {
  const gateway = new AIGateway(gatewayConfigThreads);
  for (const thread of [makeThread("thread-1", 1_000), makeThread("thread-2", 2_000), makeThread("thread-3", 3_000)]) {
    await threadsRepository.saveThread({thread});
  }

  const first = await gateway.listThreads({
    userContext: sampleUserContext,
    page: {
      limit: 2,
      startingAfter: null,
      endingBefore: null,
    },
  });
  const next = await gateway.listThreads({
    userContext: sampleUserContext,
    page: {
      limit: 2,
      startingAfter: null,
      endingBefore: first.items[first.items.length - 1]?.id ?? null,
    },
  });

  expect([
    first.items.map(thread => thread.id),
    first.hasMore,
    next.items.map(thread => thread.id),
    next.hasMore,
  ]).toEqual([["thread-3", "thread-2"], true, ["thread-1"], false]);
});
