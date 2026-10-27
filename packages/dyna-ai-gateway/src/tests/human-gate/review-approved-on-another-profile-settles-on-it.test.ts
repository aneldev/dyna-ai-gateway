import {
  AIGateway,
  EGatewayResponseKind,
  EResumeAction,
  ERunStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigReviewAnswers,
  plainProfile,
} from "./review-answers.config";

/**
 * A review pause resumed on another profile (D65 on D99): the review is already decided by the pause, so the new profile needs
 * neither the run's tools nor `reviewAnswers`; the decision settles the answer, and the run is stored with the profile it
 * settled on.
 */
test("a reviewed answer approved with another profile is delivered, and the run is stored with that profile", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigReviewAnswers, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({text: "It is noon."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What time is it?",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected a pause, got ${paused.kind}`);

  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
    profileId: plainProfile.id,
  }).response;

  const run = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });
  expect([
    response.kind === EGatewayResponseKind.ANSWER ? response.text : response.kind,
    [run?.status, run?.profileId],
  ]).toEqual([
    "It is noon.",
    [ERunStatus.DONE, plainProfile.id],
  ]);
});
