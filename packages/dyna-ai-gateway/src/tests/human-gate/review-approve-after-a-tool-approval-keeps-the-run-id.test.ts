import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EPauseKind,
  EResumeAction,
  ERunStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigReviewAnswers} from "./review-answers.config";

/**
 * One run can pause twice (D99): first for the approval of a tool, then for the review of the answer the resumed step wrote.
 * The second pause keeps the run's id and sums its steps; approving the review finishes that same run, with the tool's result
 * on the thread from the first pause.
 */
test("a run that paused for a tool and then for its answer keeps one run id, and the approved answer finishes it", async () => {
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

  llmClient.enqueueRunStep({text: "Refunded 500 EUR."});
  const pausedForReview = await gateway.resume({
    userContext: sampleUserContext,
    runId: pausedForTool.envelopes[0].runId,
    pauseId: pausedForTool.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;
  if (pausedForReview.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected a second pause, got ${pausedForReview.kind}`);

  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: pausedForReview.envelopes[0].runId,
    pauseId: pausedForReview.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;

  const storedRun = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: pausedForTool.envelopes[0].runId,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigReviewAnswers,
    threadId: pausedForTool.threadId,
  });
  expect([
    [pausedForTool.envelopes[0].kind, pausedForReview.envelopes[0].kind],
    pausedForReview.envelopes[0].runId === pausedForTool.envelopes[0].runId,
    response.kind === EGatewayResponseKind.ANSWER ? response.text : response.kind,
    [storedRun?.status, storedRun?.steps],
    toolResults.map(part => [part.toolName, part.output]),
  ]).toEqual([
    [EPauseKind.TOOL_APPROVAL, EPauseKind.RESULT_REVIEW],
    true,
    "Refunded 500 EUR.",
    [ERunStatus.DONE, 2],
    [[refundTool.name, {refunded: 500}]],
  ]);
});
