import {
  sampleAddArgs,
  sampleCheckArgs,
} from "../../../internal/usage-guard/tests/utils/usageGuardFixtures";

import {InMemoryUsageAdapter} from "../InMemoryUsageAdapter";

/** The double's job: a test reads back exactly what the gateway asked and reported, every factor included, in order. */
test("the adapter approves by default and records every check and every report with all their factors", async () => {
  const adapter = new InMemoryUsageAdapter();

  const result = await adapter.check(sampleCheckArgs);
  await adapter.addUsage(sampleAddArgs);
  await adapter.addUsage({
    ...sampleAddArgs,
    traceId: "trace-2",
  });

  expect([result, adapter.checkCalls, adapter.addUsageCalls.map(call => call.traceId)]).toEqual([
    {approved: true},
    [sampleCheckArgs],
    ["trace-1", "trace-2"],
  ]);
});
