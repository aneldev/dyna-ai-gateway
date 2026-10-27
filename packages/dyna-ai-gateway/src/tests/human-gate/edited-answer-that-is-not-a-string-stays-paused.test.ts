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

import {gatewayConfigReviewAnswers} from "./review-answers.config";

/**
 * On a reviewed answer, `editedInput` is the new text (D99): an EDIT that carries anything else (an object, as a tool edit
 * would) is a 400 before the run leaves PAUSED, so the pause is still there for a proper decision.
 */
test("an EDIT of a reviewed answer whose editedInput is not a string is a 400 and the run stays paused", async () => {
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

  const refused: unknown = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.EDIT,
      editedInput: {text: "It is one."},
    }],
  }).response.then(() => null, (thrown: unknown) => thrown);

  const storedRun = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });
  expect([
    refused,
    [storedRun?.status, storedRun?.answer?.result.text],
  ]).toMatchObject([
    {
      status: 400,
      data: {editedInputType: "object"},
    },
    [ERunStatus.PAUSED, "It is noon."],
  ]);
});
