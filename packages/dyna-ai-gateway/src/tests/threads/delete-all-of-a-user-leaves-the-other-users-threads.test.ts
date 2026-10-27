import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {
  loadRemains,
  makeDeleteScenario,
} from "../internal/utils/makeDeleteScenario";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigDelete} from "./delete.config";

/** `delete({tenantId, threadIds: "all", userId})` wipes one user's conversations and leaves the other users of the tenant untouched (D119). */
test("delete all of a user removes that user's threads only", async () => {
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

  const deleted = await gateway.delete({
    tenantId,
    threadIds: "all",
    userId,
  });

  const user = await Promise.all(scenario.user.map(thread => loadRemains(gatewayConfigDelete, tenantId, thread)));
  const other = await Promise.all(scenario.other.map(thread => loadRemains(gatewayConfigDelete, tenantId, thread)));
  expect([
    deleted,
    user.map(remains => remains.thread),
    other.map(remains => [remains.thread, remains.turns > 0, remains.traces > 0]),
    other[1]?.run,
  ]).toEqual([
    {threads: 2},
    [false, false],
    [[true, true, true], [true, true, true]],
    true,
  ]);
});
