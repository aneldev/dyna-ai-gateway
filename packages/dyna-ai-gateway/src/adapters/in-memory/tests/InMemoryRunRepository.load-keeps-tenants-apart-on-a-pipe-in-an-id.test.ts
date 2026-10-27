import {
  IRun,
  ERunStatus,
} from "../../../internal/run-store";

import {InMemoryRunRepository} from "../InMemoryRunRepository";

const runOfTenantA: IRun = {
  id: "b|r1",
  tenantId: "a",
  threadId: "thread-1",
  userId: "user-a",
  profileId: "profile-1",
  status: ERunStatus.PAUSED,
  request: {
    modelId: "model-a",
    system: "You are a test",
    maxOutputTokens: 500,
  },
  toolNames: [],
  startTurnCount: 0,
  chunkIds: [],
  templateVersion: 1,
  messages: [],
  steps: 1,
  createdAt: new Date(1_000),
  updatedAt: new Date(1_000),
};

/** Tenant `a` with run `b|r1` and tenant `a|b` with run `r1` were one Map key with a `|` separator; every keyed adapter shares `makeTenantKey`. */
test("load does not return a run of another tenant whose tenant and id join to the same text", async () => {
  const repository = new InMemoryRunRepository();
  await repository.save({run: runOfTenantA});

  const crossTenant = await repository.load({
    tenantId: "a|b",
    runId: "r1",
  });
  const own = await repository.load({
    tenantId: "a",
    runId: "b|r1",
  });

  expect([crossTenant, own?.id]).toEqual([null, "b|r1"]);
});
