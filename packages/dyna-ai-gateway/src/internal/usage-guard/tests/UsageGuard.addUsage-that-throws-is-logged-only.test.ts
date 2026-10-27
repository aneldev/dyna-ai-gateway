import {IUsageAdapter} from "../types";
import {UsageGuard} from "../UsageGuard";

import {sampleAddArgs} from "./utils/usageGuardFixtures";

/** A report that fails never fails the call that already ran: the guard logs the error and resolves. */
test("an addUsage whose adapter throws resolves, and the error is logged", async () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const adapter: IUsageAdapter = {
    check: async () => ({approved: true}),
    addUsage: async () => {
      throw new Error("ledger database is down");
    },
  };
  const guard = new UsageGuard({adapter});

  await expect(guard.addUsage(sampleAddArgs)).resolves.toBeUndefined();
  expect([
    consoleError.mock.calls.length,
    String(consoleError.mock.calls[0]?.[0]).includes("Internal error 5378215504012"),
  ]).toEqual([1, true]);
  consoleError.mockRestore();
});
