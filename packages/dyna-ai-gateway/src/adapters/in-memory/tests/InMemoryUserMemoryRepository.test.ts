import {IUserMemoryFact} from "../../../internal/user-memory-store";

import {InMemoryUserMemoryRepository} from "../InMemoryUserMemoryRepository";

const makeFact = (key: string, value: string): IUserMemoryFact => ({
  key,
  value,
  updatedAt: new Date(1_000),
});

const owner = {
  tenantId: "tenant-a",
  userId: "user-a",
};

describe("InMemoryUserMemoryRepository", () => {
  test("load returns an empty list for a user without facts", async () => {
    const repository = new InMemoryUserMemoryRepository();
    expect(await repository.load(owner)).toEqual([]);
  });

  test("load returns the facts saved for that user", async () => {
    const repository = new InMemoryUserMemoryRepository();
    await repository.saveAll({
      ...owner,
      facts: [makeFact("language", "German")],
    });
    expect(await repository.load(owner)).toEqual([makeFact("language", "German")]);
  });

  test("saveAll replaces all facts of the user", async () => {
    const repository = new InMemoryUserMemoryRepository();
    await repository.saveAll({
      ...owner,
      facts: [makeFact("language", "German"), makeFact("role", "accountant")],
    });
    await repository.saveAll({
      ...owner,
      facts: [makeFact("role", "developer")],
    });
    expect(await repository.load(owner)).toEqual([makeFact("role", "developer")]);
  });

  test("load does not return the facts of another user", async () => {
    const repository = new InMemoryUserMemoryRepository();
    await repository.saveAll({
      ...owner,
      facts: [makeFact("language", "German")],
    });
    expect(await repository.load({
      tenantId: "tenant-a",
      userId: "user-b",
    })).toEqual([]);
  });

  test("load does not return the facts of the same user id in another tenant", async () => {
    const repository = new InMemoryUserMemoryRepository();
    await repository.saveAll({
      ...owner,
      facts: [makeFact("language", "German")],
    });
    expect(await repository.load({
      tenantId: "tenant-b",
      userId: "user-a",
    })).toEqual([]);
  });

  describe("deleteByUser (GDPR)", () => {
    test("removes the user's facts and returns their number", async () => {
      const repository = new InMemoryUserMemoryRepository();
      await repository.saveAll({
        ...owner,
        facts: [makeFact("language", "German"), makeFact("role", "developer")],
      });
      expect(await repository.deleteByUser(owner)).toBe(2);
      expect(await repository.load(owner)).toEqual([]);
    });

    test("returns 0 for a user without facts and touches no other user or tenant", async () => {
      const repository = new InMemoryUserMemoryRepository();
      const otherUser = {
        ...owner,
        userId: "user-b",
      };
      const otherTenant = {
        ...owner,
        tenantId: "tenant-b",
      };
      for (const target of [otherUser, otherTenant]) {
        await repository.saveAll({
          ...target,
          facts: [makeFact("language", "German")],
        });
      }
      expect(await repository.deleteByUser(owner)).toBe(0);
      expect([(await repository.load(otherUser)).length, (await repository.load(otherTenant)).length]).toEqual([1, 1]);
    });
  });
});
