import {setTimeout as sleep} from "node:timers/promises";

import {abortReason} from "../abortReason";
import {makeCallSignal} from "../makeCallSignal";

test("abortReason: the call's own deadline names its timeoutMs", async () => {
  const callSignal = makeCallSignal({
    abortSignal: new AbortController().signal,
    timeoutMs: 10,
  });
  await sleep(30);
  if (!callSignal) throw new Error("Test setup: no call signal");
  expect(abortReason({callSignal})).toBe("The call timed out after 10 ms");
});
