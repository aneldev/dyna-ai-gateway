import {InMemoryThreadRepository} from "../../../adapters/in-memory";
import {
  ITurn,
  EPartKind,
  ETurnRole,
} from "../../../contracts";

import {ThreadStore} from "../ThreadStore";

const makeTurn = (text: string): ITurn => ({
  id: `turn-${text}`,
  role: ETurnRole.USER,
  parts: [
    {
      kind: EPartKind.TEXT,
      text,
    },
  ],
  createdAt: new Date(1_000),
});

/** A thread's history is read whole, oldest first (D37): no paging, every turn the thread counts. An empty thread reads as []. */
test("getTurns returns every turn of the thread, oldest first", async () => {
  const store = new ThreadStore({repository: new InMemoryThreadRepository()});
  const thread = await store.createThread({
    tenantId: "tenant-a",
    userId: "user-a",
  });
  const before = await store.getTurns({
    tenantId: "tenant-a",
    threadId: thread.id,
  });
  for (const text of ["one", "two", "three"]) {
    await store.appendTurn({
      tenantId: "tenant-a",
      threadId: thread.id,
      turn: makeTurn(text),
    });
  }
  const turns = await store.getTurns({
    tenantId: "tenant-a",
    threadId: thread.id,
  });
  expect([before, turns.map(turn => turn.id)]).toEqual([[], ["turn-one", "turn-two", "turn-three"]]);
});
