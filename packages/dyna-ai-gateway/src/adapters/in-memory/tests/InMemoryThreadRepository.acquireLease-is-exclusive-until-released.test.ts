import {
  IThread,
  EThreadStatus,
} from "../../../internal/thread-store";

import {InMemoryThreadRepository} from "../InMemoryThreadRepository";

const thread: IThread = {
  id: "th-1",
  tenantId: "t1",
  userId: "u1",
  title: "",
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
};

/** The check-and-set of the lease: a held lease refuses, a released or expired one accepts, an unknown thread refuses (D77). */
test("acquireLease accepts a free or expired lease, refuses a held one and an unknown thread", async () => {
  const repository = new InMemoryThreadRepository();
  await repository.saveThread({thread});
  const acquire = (token: string, now: number, expiresAt: number): Promise<boolean> => repository.acquireLease({
    tenantId: "t1",
    threadId: "th-1",
    token,
    now: new Date(now),
    expiresAt: new Date(expiresAt),
  });

  const free = await acquire("a", 10, 20);
  const held = await acquire("b", 15, 25);
  const expired = await acquire("c", 20, 30);
  await repository.releaseLease({
    tenantId: "t1",
    threadId: "th-1",
    token: "c",
  });
  const released = await acquire("d", 21, 31);
  const unknown = await repository.acquireLease({
    tenantId: "t1",
    threadId: "th-none",
    token: "e",
    now: new Date(0),
    expiresAt: new Date(1),
  });

  expect([free, held, expired, released, unknown]).toEqual([true, false, true, true, false]);
});
