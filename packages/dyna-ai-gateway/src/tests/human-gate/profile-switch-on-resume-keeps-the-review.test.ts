import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EPauseKind,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {refundOnApprovalTool} from "./paused-run-with-a-file.config";
import {gatewayConfigProfileSwitchOnResume} from "./profile-switch-on-resume.config";

/**
 * A resume may continue on another profile (D65), but not on one that skips what the run started under: the review of the
 * answer is the union of both profiles (D113). A run on a reviewing profile, resumed on one without review, still pauses its
 * answer for the reviewer instead of delivering it.
 */
test("a run resumed on a profile without review still pauses its answer for review", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigProfileSwitchOnResume, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: refundOnApprovalTool.name,
      input: {amount: 20},
    },
  });
  llmClient.enqueueRunStep({text: "Refunded 20 EUR."});
  const paused = await gateway.run({
    profileId: "reviewed",
    userContext: sampleUserContext,
    prompt: "Refund my 20 EUR",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected a pause, got ${paused.kind}`);

  const resumed = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
    profileId: "unreviewed",
  }).response;

  expect([resumed.kind, resumed.kind === EGatewayResponseKind.PAUSED ? resumed.envelopes[0].kind : null]).toEqual([
    EGatewayResponseKind.PAUSED,
    EPauseKind.RESULT_REVIEW,
  ]);
});
