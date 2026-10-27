import {
  AIGateway,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {askOnThread} from "../internal/utils/askOnThread";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSlidingWindow} from "./sliding-window.config";

/** SLIDING_WINDOW stores nothing and asks no cheap model: no MEMORY_WORKING call is traced, the thread's state stays empty. */
test("SLIDING_WINDOW: after two answers there is no memory call and the thread's memory is empty", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSlidingWindow, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const first = await askOnThread({
    gateway,
    llmClient,
    prompt: "Hello",
  });
  await askOnThread({
    gateway,
    llmClient,
    prompt: "Again",
    threadId: first.threadId,
  });

  const memoryEntries = await gateway.trace.query({
    tenantId: sampleUserContext.tenantId,
    filters: {kind: ETraceKind.MEMORY_WORKING},
    skip: 0,
    limit: 10,
  });
  const memory = await gateway.getThreadMemory({
    userContext: sampleUserContext,
    threadId: first.threadId,
  });
  expect([memoryEntries.length, llmClient.completeCalls.filter(call => call.meta.kind === ETraceKind.MEMORY_WORKING).length, memory]).toEqual([
    0,
    0,
    {
      summary: "",
      facts: {},
      updatedAtTurn: 0,
    },
  ]);
});
