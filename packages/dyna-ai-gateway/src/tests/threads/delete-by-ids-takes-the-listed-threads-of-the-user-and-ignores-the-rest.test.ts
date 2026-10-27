import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {
  loadRemains,
  makeDeleteScenario,
} from "../internal/utils/makeDeleteScenario";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigDelete} from "./delete.config";

/**
 * The user's own "delete conversation": `delete({tenantId, threadIds: [...], userId})` takes the listed threads of that user.
 * An id of another user, an unknown id and an id of another tenant are ignored and not counted; an empty list deletes
 * nothing and counts 0 (D119).
 */
test("delete by ids removes the listed threads of the user; foreign, unknown and other-tenant ids are ignored; an empty list is 0", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDelete, {llmClient: () => llmClient});
  const scenario = await makeDeleteScenario({
    gateway,
    llmClient,
  });
  const {
    tenantId,
    userId,
  } = sampleUserContext;
  const [own, ownPaused] = scenario.user;
  const [foreign] = scenario.other;
  if (!own || !ownPaused || !foreign) throw new Error("Test setup: the scenario has two threads per user");

  const empty = await gateway.delete({
    tenantId,
    threadIds: [],
  });
  const otherTenant = await gateway.delete({
    tenantId: "tenant-z",
    threadIds: [own.threadId],
  });
  const deleted = await gateway.delete({
    tenantId,
    threadIds: [own.threadId, foreign.threadId, "no-such-thread"],
    userId,
  });

  expect([
    empty,
    otherTenant,
    deleted,
    (await loadRemains(gatewayConfigDelete, tenantId, own)).thread,
    (await loadRemains(gatewayConfigDelete, tenantId, ownPaused)).thread,
    (await loadRemains(gatewayConfigDelete, tenantId, foreign)).thread,
  ]).toEqual([
    {threads: 0},
    {threads: 0},
    {threads: 1},
    false,
    true,
    true,
  ]);
});
