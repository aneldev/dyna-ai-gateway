import {ToolRegistry} from "../ToolRegistry";

import {
  IHangingToolSeen,
  makeHangingTool,
  userContext,
} from "./utils/hangingToolFixtures";

test("ToolRegistry.execute: a signal that is already aborted refuses the call before the tool runs", async () => {
  const seen: IHangingToolSeen = {};
  const registry = new ToolRegistry({tools: [makeHangingTool(seen)]});
  const controller = new AbortController();
  controller.abort(new Error("gone"));

  await expect(registry.execute({
    name: "slow_lookup",
    input: {id: "4711"},
    userContext,
    threadId: "thread-1",
    abortSignal: controller.signal,
  })).rejects.toThrow("gone");
  expect(seen.signal).toBeUndefined();
});
