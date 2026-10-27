import {
  makeProfile,
  makeProfileStore,
} from "./utils/makeProfileStore";

/** `listProfiles` is scoped by tenant: another tenant's profiles never appear, and a tenant without profiles gets an empty list. */
test("listProfiles returns the profiles of the tenant only, and an empty list for a tenant without one", async () => {
  const {store} = await makeProfileStore({profiles: [makeProfile("tenant-a", "chat"), makeProfile("tenant-a", "careful"), makeProfile("tenant-b", "chat")]});

  const [ofA, ofB, ofC] = await Promise.all([
    store.listProfiles({tenantId: "tenant-a"}),
    store.listProfiles({tenantId: "tenant-b"}),
    store.listProfiles({tenantId: "tenant-c"}),
  ]);

  expect([
    ofA.map(profile => [profile.tenantId, profile.id]),
    ofB.map(profile => [profile.tenantId, profile.id]),
    ofC,
  ]).toEqual([
    [["tenant-a", "chat"], ["tenant-a", "careful"]],
    [["tenant-b", "chat"]],
    [],
  ]);
});
