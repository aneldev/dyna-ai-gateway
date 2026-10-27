import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EPauseKind,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigToolPolicy,
  refundTool,
  refunds,
} from "./tool-policy.config";

/**
 * A refund above the threshold pauses; the policy gave a `rejectionText` for this call (D87). The stored pause carries it, the UI
 * does not need it, and a REJECT writes it with the human's reason as the tool's result in the thread, so the model reads it.
 */
test("rejecting an approval stores the policy's per-call rejection text with the human's reason as the tool's result", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigToolPolicy, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: refundTool.name,
      input: {amount: 500},
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund me 500 EUR.",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected a pause, got ${paused.kind}`);
  const storedRun = await gatewayConfigToolPolicy.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const pending = storedRun?.pending?.[0];

  llmClient.enqueueRunStep({text: "The refund was declined."});
  const resumed = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.REJECT,
      text: "the item was not returned",
    }],
  }).response;

  const [result] = await loadToolResults({
    config: gatewayConfigToolPolicy,
    threadId: paused.threadId,
  });
  expect([
    pending?.kind === EPauseKind.TOOL_APPROVAL ? pending.rejectionText : null,
    resumed.kind,
    result?.rejected,
    result?.output,
    refunds,
  ]).toEqual([
    "The refund of 500 EUR was declined by the support agent; nothing was refunded.",
    EGatewayResponseKind.ANSWER,
    true,
    "The refund of 500 EUR was declined by the support agent; nothing was refunded. Reason: the item was not returned",
    [],
  ]);
});
