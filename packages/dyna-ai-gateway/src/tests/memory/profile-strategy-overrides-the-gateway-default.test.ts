import {
  AIGateway,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {askOnThread} from "../internal/utils/askOnThread";
import {makeModelResult} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSlidingWindow} from "./sliding-window.config";

/**
 * One gateway, two bots: the gateway's default is SLIDING_WINDOW, the profile `summary` says SUMMARY_BUFFER. A call on `summary`
 * runs the memory update; a call on `default` does not.
 */
test("the profile's workingMemory strategy wins over the gateway's default", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSlidingWindow, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    structured: {
      summary: "The user said hello.",
      facts: [],
    },
  }), ETraceKind.MEMORY_WORKING);
  const onSummary = await askOnThread({
    gateway,
    llmClient,
    profileId: "summary",
    prompt: "Hello",
  });
  const onDefault = await askOnThread({
    gateway,
    llmClient,
    prompt: "Hello",
  });

  const [summaryMemory, defaultMemory] = await Promise.all([onSummary.threadId, onDefault.threadId].map(threadId => gateway.getThreadMemory({
    userContext: sampleUserContext,
    threadId,
  })));
  expect([summaryMemory.summary, summaryMemory.updatedAtTurn, defaultMemory.updatedAtTurn, llmClient.completeCalls.filter(call => call.meta.kind === ETraceKind.MEMORY_WORKING).length])
    .toEqual(["The user said hello.", 2, 0, 1]);
});
