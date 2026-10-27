import {
  IUsageAdapter,
  USAGE_CHECK_FAILED_DENY_CODE,
} from "../types";
import {UsageGuard} from "../UsageGuard";

import {sampleCheckArgs} from "./utils/usageGuardFixtures";

/** Fail closed: an adapter that cannot answer has not said yes. The call is refused with the gateway's own code and the error is logged. */
test("a check whose adapter throws is a denial with the gateway's deny code, and the error is logged", async () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const adapter: IUsageAdapter = {
    check: async () => {
      throw new Error("ledger database is down");
    },
    addUsage: async () => undefined,
  };
  const guard = new UsageGuard({adapter});

  const result = await guard.check(sampleCheckArgs);

  expect([
    result,
    consoleError.mock.calls.length,
    String(consoleError.mock.calls[0]?.[0]).includes("Internal error 5378215504011"),
  ]).toEqual([
    {
      approved: false,
      denyCode: USAGE_CHECK_FAILED_DENY_CODE,
    },
    1,
    true,
  ]);
  consoleError.mockRestore();
});
