import {
  ITurn,
  EPartKind,
  ETurnRole,
} from "../../../contracts";

import {InMemoryThreadRepository} from "../InMemoryThreadRepository";

const makeTurn = (turnId: string): ITurn => ({
  id: turnId,
  role: ETurnRole.USER,
  parts: [
    {
      kind: EPartKind.TEXT,
      text: `Text of ${turnId}`,
    },
  ],
  createdAt: new Date(1_000),
});

const appendTurns = async (repository: InMemoryThreadRepository, threadId: string, turnIds: string[]): Promise<void> => {
  for (const turnId of turnIds) {
    await repository.appendTurn({
      tenantId: "tenant-a",
      threadId,
      turn: makeTurn(turnId),
    });
  }
};

const loadTurnIds = async (
  repository: InMemoryThreadRepository,
  page: {threadId: string; desc: boolean; skip: number; limit: number},
): Promise<string[]> => {
  const turns = await repository.loadTurns({
    tenantId: "tenant-a",
    ...page,
  });
  return turns.map(turn => turn.id);
};

describe("InMemoryThreadRepository — turns", () => {
  test("loadTurns returns an empty list for a thread without turns", async () => {
    const repository = new InMemoryThreadRepository();
    expect(await loadTurnIds(repository, {
      threadId: "thread-1",
      desc: false,
      skip: 0,
      limit: 10,
    })).toEqual([]);
  });

  test("loadTurns returns the turns oldest first when desc is false", async () => {
    const repository = new InMemoryThreadRepository();
    await appendTurns(repository, "thread-1", ["turn-1", "turn-2", "turn-3"]);
    expect(await loadTurnIds(repository, {
      threadId: "thread-1",
      desc: false,
      skip: 0,
      limit: 10,
    })).toEqual(["turn-1", "turn-2", "turn-3"]);
  });

  test("loadTurns returns the turns newest first when desc is true", async () => {
    const repository = new InMemoryThreadRepository();
    await appendTurns(repository, "thread-1", ["turn-1", "turn-2", "turn-3"]);
    expect(await loadTurnIds(repository, {
      threadId: "thread-1",
      desc: true,
      skip: 0,
      limit: 10,
    })).toEqual(["turn-3", "turn-2", "turn-1"]);
  });

  test("loadTurns applies skip and limit after the ordering", async () => {
    const repository = new InMemoryThreadRepository();
    await appendTurns(repository, "thread-1", ["turn-1", "turn-2", "turn-3", "turn-4"]);
    expect(await loadTurnIds(repository, {
      threadId: "thread-1",
      desc: true,
      skip: 1,
      limit: 2,
    })).toEqual(["turn-3", "turn-2"]);
  });

  test("loadTurns returns only the turns of that thread", async () => {
    const repository = new InMemoryThreadRepository();
    await appendTurns(repository, "thread-1", ["turn-1"]);
    await appendTurns(repository, "thread-2", ["turn-2"]);
    expect(await loadTurnIds(repository, {
      threadId: "thread-1",
      desc: false,
      skip: 0,
      limit: 10,
    })).toEqual(["turn-1"]);
  });

  test("loadTurns returns the full turn as appended", async () => {
    const repository = new InMemoryThreadRepository();
    await appendTurns(repository, "thread-1", ["turn-1"]);
    const turns = await repository.loadTurns({
      tenantId: "tenant-a",
      threadId: "thread-1",
      desc: false,
      skip: 0,
      limit: 10,
    });
    expect(turns).toEqual([makeTurn("turn-1")]);
  });
});
