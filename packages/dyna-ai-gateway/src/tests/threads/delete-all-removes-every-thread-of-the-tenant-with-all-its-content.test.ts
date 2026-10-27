import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {
  loadRemains,
  makeDeleteScenario,
} from "../internal/utils/makeDeleteScenario";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigDelete} from "./delete.config";

/**
 * `delete({tenantId, threadIds: "all"})` is the tenant's reset: thread, turns, runs (a PAUSED one included) and trace entries
 * of every thread are gone, the count is the number of threads, and a second call finds nothing (D119).
 */
test("delete all removes every thread of the tenant with its turns, runs and trace entries; a second delete finds nothing", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDelete, {llmClient: () => llmClient});
  const scenario = await makeDeleteScenario({
    gateway,
    llmClient,
  });
  const {tenantId} = sampleUserContext;
  const all = [...scenario.user, ...scenario.other];
  const before = await Promise.all(all.map(thread => loadRemains(gatewayConfigDelete, tenantId, thread)));

  const deleted = await gateway.delete({
    tenantId,
    threadIds: "all",
  });
  const again = await gateway.delete({
    tenantId,
    threadIds: "all",
  });

  const after = await Promise.all(all.map(thread => loadRemains(gatewayConfigDelete, tenantId, thread)));
  const gone = {
    thread: false,
    turns: 0,
    run: false,
    traces: 0,
  };
  expect([
    before.map(remains => [remains.thread, remains.turns > 0]),
    // A scripted run step records no trace entry; the two asks do
    [before[0]?.traces, before[2]?.traces].map(traces => (traces ?? 0) > 0),
    before.map(remains => remains.run),
    deleted,
    again,
    after,
  ]).toEqual([
    [[true, true], [true, true], [true, true], [true, true]],
    [true, true],
    [false, true, false, true],
    {threads: 4},
    {threads: 0},
    [gone, gone, gone, gone],
  ]);
});
