import {IAIProfile} from "../../../internal/ai-profile-store";

import {InMemoryAIProfileRepository} from "../InMemoryAIProfileRepository";

const makeProfile = (tenantId: string, profileId: string, name = "Profile"): IAIProfile => ({
  id: profileId,
  tenantId,
  name,
  modelId: "model-a",
  allowedTools: [],
  approvals: [],
  promptAddendum: "",
  limits: {
    maxStepsPerRun: 5,
    maxOutputTokens: 500,
  },
});

describe("InMemoryAIProfileRepository", () => {
  test("loadByTenant returns an empty list for a tenant without profiles", async () => {
    const repository = new InMemoryAIProfileRepository();
    expect(await repository.loadByTenant({tenantId: "tenant-a"})).toEqual([]);
  });

  test("loadByTenant returns only the profiles of that tenant", async () => {
    const repository = new InMemoryAIProfileRepository();
    await repository.save({
      tenantId: "tenant-a",
      profile: makeProfile("tenant-a", "profile-1"),
    });
    await repository.save({
      tenantId: "tenant-b",
      profile: makeProfile("tenant-b", "profile-1"),
    });
    expect(await repository.loadByTenant({tenantId: "tenant-a"})).toEqual([makeProfile("tenant-a", "profile-1")]);
  });

  test("save replaces the profile with the same profileId", async () => {
    const repository = new InMemoryAIProfileRepository();
    await repository.save({
      tenantId: "tenant-a",
      profile: makeProfile("tenant-a", "profile-1", "Old"),
    });
    await repository.save({
      tenantId: "tenant-a",
      profile: makeProfile("tenant-a", "profile-1", "New"),
    });
    expect(await repository.loadByTenant({tenantId: "tenant-a"})).toEqual([makeProfile("tenant-a", "profile-1", "New")]);
  });

  test("remove deletes the profile of that tenant only", async () => {
    const repository = new InMemoryAIProfileRepository();
    await repository.save({
      tenantId: "tenant-a",
      profile: makeProfile("tenant-a", "profile-1"),
    });
    await repository.save({
      tenantId: "tenant-b",
      profile: makeProfile("tenant-b", "profile-1"),
    });
    await repository.remove({
      tenantId: "tenant-a",
      profileId: "profile-1",
    });
    expect(await repository.loadByTenant({tenantId: "tenant-a"})).toEqual([]);
    expect(await repository.loadByTenant({tenantId: "tenant-b"})).toHaveLength(1);
  });

  test("the profiles given to the constructor are loaded under their tenant, as copies", async () => {
    const seed = makeProfile("tenant-a", "default");
    const repository = new InMemoryAIProfileRepository({profiles: [seed, makeProfile("tenant-b", "other")]});
    seed.name = "changed after construction";
    expect(await repository.loadByTenant({tenantId: "tenant-a"})).toEqual([makeProfile("tenant-a", "default")]);
  });
});
