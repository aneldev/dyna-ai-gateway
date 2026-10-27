import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EPauseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  REFUND_REASON_CODE,
  gatewayConfigToolPolicy,
  refundTool,
} from "./tool-policy.config";

/**
 * A refund above the threshold pauses; the policy gave a `reasonCode` for this call. The envelope the UI receives carries
 * it for the approval card, and the stored pause keeps it, so `listPausedRuns` shows it after a restart too.
 */
test("the approval envelope carries the policy's reason code, in the response and in the stored pause", async () => {
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

  expect([
    paused.envelopes[0].kind === EPauseKind.TOOL_APPROVAL ? paused.envelopes[0].reasonCode : null,
    pending?.kind === EPauseKind.TOOL_APPROVAL ? pending.reasonCode : null,
  ]).toEqual([
    REFUND_REASON_CODE,
    REFUND_REASON_CODE,
  ]);
});
