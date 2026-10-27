import {InMemoryThreadRepository} from "../../../adapters/in-memory";

import {ThreadStore} from "../ThreadStore";

/**
 * Only the holder frees the thread: a release with another token (the late `finally` of a call that overran and lost its lease)
 * changes nothing; the holder's own release frees it (D77).
 */
test("releaseLease ignores another token and honours the holder's", async () => {
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
  const load = async (): Promise<string | null> => (await repository.loadThread({
    tenantId: "t1",
    threadId: thread.id,
  }))?.lease?.token ?? null;

  await store.releaseLease({
    tenantId: "t1",
    threadId: thread.id,
    token: "someone-else",
  });
  const afterStranger = await load();
  await store.releaseLease({
    tenantId: "t1",
    threadId: thread.id,
    token,
  });
  const afterHolder = await load();

  expect([afterStranger, afterHolder]).toEqual([token, null]);
});
