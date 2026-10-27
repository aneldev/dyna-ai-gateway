import {InMemoryThreadRepository} from "../../../adapters/in-memory";

import {ThreadStore} from "../ThreadStore";

/** A lease that was never released (the server died) counts as free once `leaseMs` has passed: the next call takes the thread (D77). */
test("acquireLease takes a thread whose lease has expired", async () => {
  const repository = new InMemoryThreadRepository();
  const store = new ThreadStore({
    repository,
    leaseMs: 0,
  });
  const thread = await store.createThread({
    tenantId: "t1",
    userId: "u1",
  });
  const first = await store.acquireLease({
    tenantId: "t1",
    threadId: thread.id,
  });

  const second = await store.acquireLease({
    tenantId: "t1",
    threadId: thread.id,
  });

  const stored = await repository.loadThread({
    tenantId: "t1",
    threadId: thread.id,
  });
  expect([second === first, stored?.lease?.token]).toEqual([false, second]);
});
