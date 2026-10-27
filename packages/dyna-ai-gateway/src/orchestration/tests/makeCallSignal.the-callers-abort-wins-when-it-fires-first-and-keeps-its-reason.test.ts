import {makeCallSignal} from "../makeCallSignal";

test("makeCallSignal: both given, the caller's abort wins when it fires first, and its reason is kept", () => {
  const controller = new AbortController();
  const callSignal = makeCallSignal({
    abortSignal: controller.signal,
    timeoutMs: 10_000,
  });
  expect(callSignal?.signal.aborted).toBe(false);
  controller.abort(new Error("stop pressed"));
  expect([
    callSignal?.signal.aborted,
    (callSignal?.signal.reason as Error).message,
    callSignal?.deadline?.aborted,
  ]).toEqual([true, "stop pressed", false]);
});
