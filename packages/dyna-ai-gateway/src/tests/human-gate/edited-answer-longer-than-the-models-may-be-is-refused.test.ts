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
 * The reviewer's edit is stored as the assistant's turn and goes back to the model as history: it may be as long as the
 * model's own answer may be (`maxOutputTokens` × 4 characters), no longer. A longer edit is a 400 and the run stays paused.
 */
test("an edited answer over maxOutputTokens × 4 characters is a 400 and the run stays paused", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigReviewAnswers, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({text: "Your order arrives Thursday."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "When does my order arrive?",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected a pause, got ${paused.kind}`);
  const {
    runId,
    pauseId,
  } = paused.envelopes[0];
  const stored = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId,
  });
  const maxChars = (stored?.request.maxOutputTokens ?? 0) * 4;

  const refused: unknown = await gateway.resume({
    userContext: sampleUserContext,
    runId,
    pauseId,
    decisions: [{
      action: EResumeAction.EDIT,
      editedInput: "x".repeat(maxChars + 1),
    }],
  }).response.then(() => null, (thrown: unknown) => thrown);

  const stillPaused = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId,
  });
  expect([refused, stillPaused?.status]).toMatchObject([
    {
      code: 5377210486181,
      status: 400,
      data: {
        length: maxChars + 1,
        maxChars,
      },
    },
    ERunStatus.PAUSED,
  ]);
});
