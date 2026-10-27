import {makeCallSignal} from "../makeCallSignal";

test("makeCallSignal: a signal alone is the call's signal, with no deadline", () => {
  const controller = new AbortController();
  const callSignal = makeCallSignal({abortSignal: controller.signal});
  expect([callSignal?.signal, callSignal?.deadline, callSignal?.timeoutMs]).toEqual([controller.signal, undefined, undefined]);
});
