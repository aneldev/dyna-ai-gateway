import {setTimeout as sleep} from "node:timers/promises";

import {abortReason} from "../abortReason";
import {makeCallSignal} from "../makeCallSignal";

/** The caller passed its own `AbortSignal.timeout` next to a `timeoutMs` that did not fire: the words name no deadline of the gateway. */
test("abortReason: the caller's own timeout signal reads as a timeout, without the gateway's number", async () => {
  const callSignal = makeCallSignal({
    abortSignal: AbortSignal.timeout(10),
    timeoutMs: 60_000,
  });
  await sleep(30);
  if (!callSignal) throw new Error("Test setup: no call signal");
  expect(abortReason({callSignal})).toBe("The call timed out");
});
