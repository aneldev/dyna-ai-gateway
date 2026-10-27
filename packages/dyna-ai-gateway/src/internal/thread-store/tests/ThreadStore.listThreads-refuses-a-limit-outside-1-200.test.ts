import {InMemoryThreadRepository} from "../../../adapters/in-memory";

import {ThreadStore} from "../ThreadStore";

/** `limit` is 1–200 (D37); the store refuses the rest before the repository is asked. */
test("listThreads with a limit outside 1–200 is a 400", async () => {
  const store = new ThreadStore({repository: new InMemoryThreadRepository()});
  const outcomes = await Promise.allSettled([0, 201, 1.5].map(limit => store.listThreads({
    tenantId: "tenant-a",
    userId: "user-a",
    page: {
      limit,
      startingAfter: null,
      endingBefore: null,
    },
  })));
  const badRequest = {
    status: "rejected",
    reason: expect.objectContaining({
      code: 5379462948271,
      status: 400,
    }),
  };
  expect(outcomes).toEqual([badRequest, badRequest, badRequest]);
});
