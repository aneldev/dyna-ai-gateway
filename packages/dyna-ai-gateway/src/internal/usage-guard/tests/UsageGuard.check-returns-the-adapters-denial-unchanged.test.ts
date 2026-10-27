import {InMemoryUsageAdapter} from "../../../adapters/in-memory";

import {UsageGuard} from "../UsageGuard";

import {sampleCheckArgs} from "./utils/usageGuardFixtures";

/** The app's no travels through the guard as it is: its own code and its own message for the user, nothing added, nothing read. */
test("check returns the adapter's denial with the app's code and user message unchanged", async () => {
  const adapter = new InMemoryUsageAdapter({
    deny: () => ({
      approved: false,
      denyCode: "daily_limit_reached",
      denyUserMessage: "Ihr Tageslimit ist erreicht.",
    }),
  });
  const guard = new UsageGuard({adapter});

  expect(await guard.check(sampleCheckArgs)).toEqual({
    approved: false,
    denyCode: "daily_limit_reached",
    denyUserMessage: "Ihr Tageslimit ist erreicht.",
  });
});
