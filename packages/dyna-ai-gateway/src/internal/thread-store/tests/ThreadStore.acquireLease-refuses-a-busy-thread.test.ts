import {InMemoryThreadRepository} from "../../../adapters/in-memory";

import {ThreadStore} from "../ThreadStore";

/** A thread whose lease is held is busy: the second acquire is a 409 and the first token still holds the thread (D77). */
test("acquireLease on a thread that is held is a 409", async () => {
  const repository = new InMemoryThreadRepository();
  const store = new ThreadStore({repository});
  const thread = await store.createThread({
    tenantId: "t1",
    userId: "u1",
  });
  const token = await store.acquireLease({
    tenantId: "t1",
    threadId: thread.id,
  });

  const second = store.acquireLease({
    tenantId: "t1",
    threadId: thread.id,
  });

  await expect(second).rejects.toMatchObject({
    code: 5375384011263,
    status: 409,
  });
  const stored = await repository.loadThread({
    tenantId: "t1",
    threadId: thread.id,
  });
  expect(stored?.lease?.token).toBe(token);
});
