import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {refundTool} from "../internal/samples/tools";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigGuardedTools} from "./guarded-tools.config";
import {lookupOrderTool} from "./parallel-tools.config";

/**
 * A guarded tool is hidden until its requirement ran in an earlier step; a call to it in the same step as the requirement is
 * refused whatever its input (D79). Before, a large refund next to the lookup paused for approval, and the approval ran it:
 * the approval question was asked before the step's tool list was consulted, so an approval could unlock a hidden tool.
 */
test("a hidden guarded tool that would need approval is refused in that step, not paused", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigGuardedTools, {llmClient: () => llmClient});
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
        toolName: refundTool.name,
        input: {amount: 500},
      },
    ],
  });
  llmClient.enqueueRunStep({text: "The order is found; I will refund in the next step."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Look up order A-1 and refund 500",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigGuardedTools,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    toolResults.map(part => [part.toolName, part.failed ?? false]),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [[lookupOrderTool.name, false], [refundTool.name, true]],
  ]);
});
