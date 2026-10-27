import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigReviewAnswers} from "./review-answers.config";

/**
 * One run pauses twice under one `runId`: for the tool, then for the review of its answer (D99). The tool's approval, sent
 * again (a retry, a second click, an end user who may approve tools), names the first pause: it is a 409 on the review and
 * the answer stays paused for the reviewer.
 */
test("the tool approval sent again on the review pause is a 409 and the answer stays paused", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigReviewAnswers, {llmClient: () => llmClient});
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
  const pausedForTool = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund me 500 EUR.",
    kbFilters: noKb,
  }).response;
  if (pausedForTool.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected a pause, got ${pausedForTool.kind}`);
  const approveTheTool = (): Promise<unknown> => gateway.resume({
    userContext: sampleUserContext,
    runId: pausedForTool.envelopes[0].runId,
    pauseId: pausedForTool.pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;
  llmClient.enqueueRunStep({text: "Refunded 500 EUR."});
  const pausedForReview = await approveTheTool();

  const retried: unknown = await approveTheTool().then(() => null, (thrown: unknown) => thrown);

  const stored = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: pausedForTool.envelopes[0].runId,
  });
  expect([(pausedForReview as {kind: string}).kind, retried, stored?.status]).toMatchObject([
    EGatewayResponseKind.PAUSED,
    {
      code: 5377210486197,
      status: 409,
    },
    ERunStatus.PAUSED,
  ]);
});
