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
 * A guarded tool (`requires`, D15) is hidden from the model until its requirement ran. A model that names it anyway, from
 * memory or by guessing, is refused: only the tools of the step may run (D72). The refund does not happen, the model reads a
 * tool error that names the tool it must run first (D88), and no approval was asked (a small refund needs none, so the refusal
 * is the only guard).
 */
test("a guarded tool called before its requirement ran is refused, not executed", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigGuardedTools, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: refundTool.name,
      input: {amount: 50},
    },
  });
  llmClient.enqueueRunStep({text: "I need to look up the order first."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 50",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigGuardedTools,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    llmClient.runCalls[0]?.tools.map(tool => tool.name).includes(refundTool.name),
    toolResults.map(part => [part.toolName, part.output]),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    true,
    [
      [
        refundTool.name,
        {error: `code: 5376189327010, status: 403, userMessage: Tool [${refundTool.name}] is not available in this step of the run. Call ${lookupOrderTool.name} first, then call it again.`},
      ],
    ],
  ]);
});
