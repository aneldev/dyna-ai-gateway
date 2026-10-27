import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {getCurrentTimeTool} from "../internal/samples/tools";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigParallelTools,
  lookupOrderTool,
} from "./parallel-tools.config";

/**
 * The model asks for two read-only tools in one step (parallel tool calls, the default of OpenAI models). Both run — at the
 * same time on a parallel profile (D101) — their results are stored in the order of the request, and the run ends with the answer.
 */
test("two read-only tool calls in one step are executed and both results are stored in request order", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigParallelTools, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCalls: [
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-1",
        toolName: lookupOrderTool.name,
        input: {orderId: "A-1"},
      },
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-2",
        toolName: getCurrentTimeTool.name,
        input: {},
      },
    ],
  });
  llmClient.enqueueRunStep({text: "Order A-1 totals 42; it is now."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What is the total of order A-1, and what time is it?",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigParallelTools,
    threadId: response.threadId ?? "",
  });
  expect([response.kind, toolResults.map(part => [part.callId, part.toolName])]).toEqual([
    EGatewayResponseKind.ANSWER,
    [["call-1", lookupOrderTool.name], ["call-2", getCurrentTimeTool.name]],
  ]);
});
