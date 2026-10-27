import {ToolRegistry} from "../ToolRegistry";

import {
  IHangingToolSeen,
  makeHangingTool,
  userContext,
} from "./utils/hangingToolFixtures";

test("ToolRegistry.execute: the tool's timeout still wins with a 504 when the caller never aborts", async () => {
  const seen: IHangingToolSeen = {};
  const registry = new ToolRegistry({
    tools: [makeHangingTool(seen)],
    toolTimeoutMs: 20,
  });
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {

    await expect(registry.execute({
      name: "slow_lookup",
      input: {id: "4711"},
      userContext,
      threadId: "thread-1",
      abortSignal: new AbortController().signal,
    })).rejects.toMatchObject({status: 504});
    expect(seen.signal?.aborted).toBe(true);
  }
  finally {
    errorSpy.mockRestore();
  }
});
