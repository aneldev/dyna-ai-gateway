import {ToolRegistry} from "../ToolRegistry";

import {
  IHangingToolSeen,
  makeHangingTool,
  userContext,
} from "./utils/hangingToolFixtures";

test("ToolRegistry.execute: the caller's abort ends the wait at once with the signal's reason, the tool's signal is aborted, no 504", async () => {
  const seen: IHangingToolSeen = {};
  const registry = new ToolRegistry({
    tools: [makeHangingTool(seen)],
    toolTimeoutMs: 10_000,
  });
  const controller = new AbortController();
  const stopPressed = new Error("stop pressed");
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const startedAt = Date.now();
    setTimeout(() => controller.abort(stopPressed), 20);

    await expect(registry.execute({
      name: "slow_lookup",
      input: {id: "4711"},
      userContext,
      threadId: "thread-1",
      abortSignal: controller.signal,
    })).rejects.toBe(stopPressed);

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(seen.signal?.aborted).toBe(true);
    expect(seen.abortedAt).toBeDefined();
    expect(errorSpy).not.toHaveBeenCalled();
  }
  finally {
    errorSpy.mockRestore();
  }
});
