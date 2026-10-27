import {setTimeout as sleep} from "node:timers/promises";

import {makeCallSignal} from "../makeCallSignal";

test("makeCallSignal: a timeout alone aborts with a TimeoutError once it passes, and the deadline is its own signal", async () => {
  const callSignal = makeCallSignal({timeoutMs: 20});
  expect(callSignal?.signal.aborted).toBe(false);
  await sleep(40);
  expect([
    callSignal?.signal.aborted,
    (callSignal?.signal.reason as Error).name,
    callSignal?.deadline,
    callSignal?.timeoutMs,
  ]).toEqual([true, "TimeoutError", callSignal?.signal, 20]);
});
