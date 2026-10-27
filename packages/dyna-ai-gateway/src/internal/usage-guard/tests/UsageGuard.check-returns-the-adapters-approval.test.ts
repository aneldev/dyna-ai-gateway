import {InMemoryUsageAdapter} from "../../../adapters/in-memory";

import {UsageGuard} from "../UsageGuard";

import {sampleCheckArgs} from "./utils/usageGuardFixtures";

/** The guard adds nothing to a yes: the adapter's answer is the guard's answer, and the adapter saw every factor of the call. */
test("check returns the adapter's approval and the adapter received the call's factors", async () => {
  const adapter = new InMemoryUsageAdapter();
  const guard = new UsageGuard({adapter});

  const result = await guard.check(sampleCheckArgs);

  expect([result, adapter.checkCalls]).toEqual([
    {approved: true},
    [sampleCheckArgs],
  ]);
});
