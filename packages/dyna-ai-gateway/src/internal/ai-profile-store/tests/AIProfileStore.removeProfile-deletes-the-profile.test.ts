import {
  makeProfile,
  makeProfileStore,
} from "./utils/makeProfileStore";

/** `removeProfile` deletes the stored profile and drops the tenant's cache: the profile is unknown at once (404), the others stay. */
test("removeProfile deletes the profile, which is unknown afterwards, and leaves the others", async () => {
  const {store} = await makeProfileStore({profiles: [makeProfile("tenant-a", "chat"), makeProfile("tenant-a", "careful")]});
  await store.getProfile({
    tenantId: "tenant-a",
    profileId: "chat",
  });

  await store.removeProfile({
    tenantId: "tenant-a",
    profileId: "chat",
  });
  const gone = store.getProfile({
    tenantId: "tenant-a",
    profileId: "chat",
  });
  const left = await store.listProfiles({tenantId: "tenant-a"});

  await expect(gone).rejects.toMatchObject({
    code: 5372567786127,
    status: 404,
  });
  expect(left.map(profile => profile.id)).toEqual(["careful"]);
});
