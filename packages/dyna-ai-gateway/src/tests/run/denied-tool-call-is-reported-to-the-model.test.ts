import {
  AIGateway,
  DEFAULT_TOOL_DENIAL_TEXT,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  CHARGE_AMOUNT,
  gatewayConfigToolPolicy,
  refundTool,
  refunds,
} from "./tool-policy.config";

/**
 * The model asks for a refund above the charge; the tool's `policy` denies it (D87). The tool never runs, the model reads the
 * denial as the tool's result and answers in its next step, the run finishes as an answer, and the thread stores the denied result.
 */
test("a tool call the policy denies is not executed, the model reads the denial and answers, the thread keeps the denied result", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigToolPolicy, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCalls: [{
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: refundTool.name,
      input: {amount: CHARGE_AMOUNT + 1},
    }],
  });
  llmClient.enqueueRunStep({text: "I cannot refund more than the charge."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund me 1001 EUR.",
    kbFilters: noKb,
  }).response;

  if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected an answer, got ${response.kind}`);
  expect(response.text).toBe("I cannot refund more than the charge.");
  expect(refunds).toEqual([]);
  const [result] = await loadToolResults({
    config: gatewayConfigToolPolicy,
    threadId: response.threadId,
  });
  expect([result?.toolName, result?.denied]).toEqual([refundTool.name, true]);
  expect(String(result?.output)).toContain(DEFAULT_TOOL_DENIAL_TEXT);
  expect(String(result?.output)).toContain("above the charge");
});
