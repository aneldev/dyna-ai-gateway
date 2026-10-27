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
  classifyIntentTool,
  gatewayConfigFirstStepTool,
} from "./first-step-tool.config";
import {lookupOrderTool} from "./parallel-tools.config";

/**
 * A tool with `visibleWhen` for the first step only (D89) runs on step 0 and is gone afterwards: a second call to it by name
 * on step 1 is refused as not offered in this step (D72, D88), while the other tool still runs. The refusal has no
 * "requires" part: nothing has to run first, the step is simply not its moment.
 */
test("a tool visible on the first step only runs there and is refused afterwards", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigFirstStepTool, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: classifyIntentTool.name,
      input: {intent: "order"},
    },
  });
  llmClient.enqueueRunStep({
    toolCalls: [
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-2",
        toolName: classifyIntentTool.name,
        input: {intent: "order"},
      },
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-3",
        toolName: lookupOrderTool.name,
        input: {orderId: "A-1"},
      },
    ],
  });
  llmClient.enqueueRunStep({text: "Order A-1 totals 42."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Where is my order A-1?",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigFirstStepTool,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    toolResults.map(part => [part.toolName, part.output]),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [
      [classifyIntentTool.name, {intent: "order"}],
      [classifyIntentTool.name, {error: `code: 5376189327010, status: 403, userMessage: Tool [${classifyIntentTool.name}] is not available in this step of the run. Use one of the tools offered in this step, or answer without it.`}],
      [lookupOrderTool.name, {
        orderId: "A-1",
        total: 42,
      }],
    ],
  ]);
});
