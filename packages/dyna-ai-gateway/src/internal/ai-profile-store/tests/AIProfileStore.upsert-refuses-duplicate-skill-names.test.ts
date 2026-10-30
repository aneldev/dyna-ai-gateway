import {
  makeProfile,
  makeProfileStore,
} from "./utils/makeProfileStore";

/**
 * A profile with two skills of one name would fail every call on it (D124): the store refuses it at the upsert with the
 * SkillRegistry's 400, and nothing is saved. Unique names are accepted and stored as given.
 */
test("upsertProfile refuses a profile whose skills share a name and stores one whose names are unique", async () => {
  const {
    store,
    repository,
  } = await makeProfileStore();
  const skill = {
    name: "refund_policy",
    description: "The refund rules",
    body: "# Refund policy",
  };

  const refused = store.upsertProfile({
    tenantId: "tenant-a",
    profile: {
      ...makeProfile("tenant-a", "careful"),
      skills: [skill, skill],
    },
  });

  await expect(refused).rejects.toMatchObject({
    status: 400,
    data: {duplicates: ["refund_policy"]},
  });
  expect(await repository.loadByTenant({tenantId: "tenant-a"})).toEqual([]);

  await store.upsertProfile({
    tenantId: "tenant-a",
    profile: {
      ...makeProfile("tenant-a", "careful"),
      skills: [skill, {
        ...skill,
        name: "escalation",
      }],
    },
  });
  const stored = await store.getProfile({
    tenantId: "tenant-a",
    profileId: "careful",
  });
  expect(stored.skills?.map(candidate => candidate.name)).toEqual(["refund_policy", "escalation"]);
});
