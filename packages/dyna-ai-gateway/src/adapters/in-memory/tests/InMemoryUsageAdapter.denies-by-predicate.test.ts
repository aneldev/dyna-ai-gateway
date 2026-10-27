import {ETraceKind} from "../../../internal/trace";
import {sampleCheckArgs} from "../../../internal/usage-guard/tests/utils/usageGuardFixtures";

import {
  IN_MEMORY_USAGE_DENY_CODE,
  InMemoryUsageAdapter,
} from "../InMemoryUsageAdapter";

/**
 * `deny` scripts the app's no per call: `true` denies with the double's own code, a result is returned as it is, and a call the
 * predicate lets through is approved — here user B and every guardrail judge are denied, user A's chat is not.
 */
test("deny decides per call: true denies with the test code, a result is returned as given, otherwise approved", async () => {
  const adapter = new InMemoryUsageAdapter({
    deny: ({userId, kind}) => {
      if (userId === "user-b") return true;
      if (kind === ETraceKind.GUARDRAIL_JUDGE) {
        return {
          approved: false,
          denyCode: "judges_are_off",
          denyUserMessage: "Checks are paused.",
        };
      }
      return false;
    },
  });

  expect([
    await adapter.check(sampleCheckArgs),
    await adapter.check({
      ...sampleCheckArgs,
      userId: "user-b",
    }),
    await adapter.check({
      ...sampleCheckArgs,
      kind: ETraceKind.GUARDRAIL_JUDGE,
    }),
  ]).toEqual([
    {approved: true},
    {
      approved: false,
      denyCode: IN_MEMORY_USAGE_DENY_CODE,
    },
    {
      approved: false,
      denyCode: "judges_are_off",
      denyUserMessage: "Checks are paused.",
    },
  ]);
});
