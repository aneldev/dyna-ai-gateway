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
  gatewayConfigCallTools,
  lookupOrderTool,
} from "./call-tools.config";

/**
 * A tool passed on the call (D66) is offered to the model and executed by the registry's pipeline, although it is in neither the
 * registry nor the profile's allowedTools: the app passed it, so it is allowed.
 */
test("a tool passed on the call is executed and its result is stored in the thread", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigCallTools, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: lookupOrderTool.name,
      input: {orderId: "A-1"},
    },
  });
  llmClient.enqueueRunStep({text: "Order A-1 totals 42."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What is the total of order A-1?",
    kbFilters: noKb,
    additionalTools: [lookupOrderTool],
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigCallTools,
    threadId: response.threadId ?? "",
  });
  expect([response.kind, toolResults.map(part => [part.toolName, part.output])]).toEqual([
    EGatewayResponseKind.ANSWER,
    [[lookupOrderTool.name, {
      orderId: "A-1",
      total: 42,
    }]],
  ]);
});
