import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigConcurrentTools,
  releaseSiblingTool,
  toolLog,
  waitForSiblingTool,
} from "./concurrent-tools.config";

/**
 * The model asks for two allowed tools in one step. On a parallel profile (the default, D101) they run at the same time: the
 * first call waits until the second has run, which is only possible when the second started before the first finished.
 * The results are still stored in request order, not in the order the tools finished.
 */
test("two allowed calls of one step run concurrently; their results are stored in request order", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigConcurrentTools, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCalls: [
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-1",
        toolName: waitForSiblingTool.name,
        input: {},
      },
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-2",
        toolName: releaseSiblingTool.name,
        input: {},
      },
    ],
  });
  llmClient.enqueueRunStep({text: "Both done."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Run both",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigConcurrentTools,
    threadId: response.threadId ?? "",
  });
  expect([response.kind, toolLog, toolResults.map(part => [part.callId, part.failed ?? false])]).toEqual([
    EGatewayResponseKind.ANSWER,
    ["wait_for_sibling:start", "release_sibling:start", "release_sibling:end", "wait_for_sibling:end"],
    [["call-1", false], ["call-2", false]],
  ]);
});
