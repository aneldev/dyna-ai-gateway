import {IToolErrorReport} from "../../../contracts";

import {ToolRegistry} from "../ToolRegistry";

import {
  IHangingToolSeen,
  makeHangingTool,
  userContext,
} from "./utils/hangingToolFixtures";

/** The caller's abort ends the wait with the signal's reason (D90): the tool did not fail, so the developer hears nothing. */
test("ToolRegistry.execute: a call the caller aborted is not reported to onToolError", async () => {
  const seen: IHangingToolSeen = {};
  const reports: IToolErrorReport[] = [];
  const registry = new ToolRegistry({
    tools: [makeHangingTool(seen)],
    toolTimeoutMs: 10_000,
    onToolError: (report): void => {
      reports.push(report);
    },
  });
  const controller = new AbortController();
  const stopPressed = new Error("stop pressed");
  setTimeout(() => controller.abort(stopPressed), 20);

  await expect(registry.execute({
    name: "slow_lookup",
    input: {id: "4711"},
    userContext,
    threadId: "thread-1",
    abortSignal: controller.signal,
    callContext: {
      callId: "call-1",
      stepIndex: 0,
    },
  })).rejects.toBe(stopPressed);

  expect(reports).toEqual([]);
});
