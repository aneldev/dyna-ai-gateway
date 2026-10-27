import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {
  loadRemains,
  makeDeleteScenario,
} from "../internal/utils/makeDeleteScenario";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigDelete} from "./delete.config";

/**
 * A thread whose lease is live has a call in flight (D77): `delete` skips it, does not count it, and deletes the rest.
 * The next call, after the call ended, takes it.
 */
test("delete skips a thread with a live lease and deletes the rest", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDelete, {llmClient: () => llmClient});
  const scenario = await makeDeleteScenario({
    gateway,
    llmClient,
  });
  const {tenantId} = sampleUserContext;
  const [busy, free] = scenario.user;
  if (!busy || !free) throw new Error("Test setup: the scenario has two threads per user");
  const now = new Date();
  await gatewayConfigDelete.threadStore.repository.acquireLease({
    tenantId,
    threadId: busy.threadId,
    token: "live-call",
    expiresAt: new Date(now.getTime() + 60_000),
    now,
  });

  const deleted = await gateway.delete({
    tenantId,
    threadIds: [busy.threadId, free.threadId],
  });
  const busyStays = (await loadRemains(gatewayConfigDelete, tenantId, busy)).thread;
  const freeGone = !(await loadRemains(gatewayConfigDelete, tenantId, free)).thread;
  await gatewayConfigDelete.threadStore.repository.releaseLease({
    tenantId,
    threadId: busy.threadId,
    token: "live-call",
  });
  const later = await gateway.delete({
    tenantId,
    threadIds: [busy.threadId, free.threadId],
  });

  expect([
    deleted,
    busyStays,
    freeGone,
    later,
  ]).toEqual([
    {threads: 1},
    true,
    true,
    {threads: 1},
  ]);
});
