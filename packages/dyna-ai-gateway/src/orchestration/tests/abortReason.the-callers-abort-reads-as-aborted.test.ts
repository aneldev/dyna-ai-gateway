import {abortReason} from "../abortReason";
import {makeCallSignal} from "../makeCallSignal";

test("abortReason: the caller's abort reads as aborted, whatever its reason", () => {
  const controller = new AbortController();
  const callSignal = makeCallSignal({
    abortSignal: controller.signal,
    timeoutMs: 60_000,
  });
  controller.abort(new Error("stop pressed"));
  if (!callSignal) throw new Error("Test setup: no call signal");
  expect(abortReason({callSignal})).toBe("The call was aborted");
});
