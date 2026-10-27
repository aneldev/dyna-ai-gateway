import {InMemoryThreadRepository} from "../../../adapters/in-memory";

import {ThreadStore} from "../ThreadStore";

/** One read goes one way (D37): `startingAfter` and `endingBefore` together are a 400, not a silent choice of one. */
test("listThreads with both cursors is a 400", async () => {
  const store = new ThreadStore({repository: new InMemoryThreadRepository()});
  await expect(store.listThreads({
    tenantId: "tenant-a",
    userId: "user-a",
    page: {
      limit: 10,
      startingAfter: "thread-1",
      endingBefore: "thread-2",
    },
  })).rejects.toMatchObject({
    code: 5379462948282,
    status: 400,
  });
});
