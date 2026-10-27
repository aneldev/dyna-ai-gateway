import {setTimeout as sleep} from "node:timers/promises";

import {makeCallSignal} from "../makeCallSignal";

test("makeCallSignal: both given, the timeout wins when it fires first, and the merged reason is the deadline's", async () => {
  const controller = new AbortController();
  const callSignal = makeCallSignal({
    abortSignal: controller.signal,
    timeoutMs: 20,
  });
  await sleep(40);
  expect([
    callSignal?.signal.aborted,
    (callSignal?.signal.reason as Error).name,
    callSignal?.signal.reason === callSignal?.deadline?.reason,
  ]).toEqual([true, "TimeoutError", true]);
});
