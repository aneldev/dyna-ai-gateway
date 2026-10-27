import {makeRun} from "../../run-store/tests/utils/runFixtures";
import {ERunStatus} from "../../run-store";

import {
  makeProfile,
  makeProfileStore,
} from "./utils/makeProfileStore";

/**
 * A paused run resumes on the profile it started with (D46): removing that profile would make the resume a 404. The store
 * refuses with a 409 that names the runs; a finished run on the profile, or a paused run of another tenant, does not hold it.
 */
test("removeProfile refuses a profile a paused run of the tenant waits on, with the run ids", async () => {
  const {store} = await makeProfileStore({
    profiles: [makeProfile("tenant-a", "careful"), makeProfile("tenant-b", "careful")],
    runs: [
      makeRun("run-paused", {
        profileId: "careful",
        status: ERunStatus.PAUSED,
      }),
      makeRun("run-done", {
        profileId: "careful",
        status: ERunStatus.DONE,
      }),
      makeRun("run-other-tenant", {
        tenantId: "tenant-b",
        profileId: "careful",
        status: ERunStatus.PAUSED,
      }),
    ],
  });

  const refused = store.removeProfile({
    tenantId: "tenant-a",
    profileId: "careful",
  });

  await expect(refused).rejects.toMatchObject({
    code: 5377780695111,
    status: 409,
    data: {
      tenantId: "tenant-a",
      profileId: "careful",
      runIds: ["run-paused"],
    },
  });
  expect((await store.listProfiles({tenantId: "tenant-a"})).map(profile => profile.id)).toEqual(["careful"]);
});
