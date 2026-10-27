import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigReviewAnswers} from "./review-answers.config";

/**
 * EDIT on a reviewed answer (D99) delivers the reviewer's text instead of the model's: it is the stored assistant turn and the
 * ANSWER's text, with the model's usage and model id (the model wrote the draft); no model is called and the run is DONE.
 */
test("an edited answer is stored and returned with the reviewer's text in place of the model's", async () => {
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

  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.EDIT,
      editedInput: "Your order arrives Friday.",
    }],
  }).response;

  const storedRun = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const turns = await gatewayConfigReviewAnswers.threadStore.repository.loadTurns({
    tenantId: sampleUser.tenantId,
    threadId: paused.threadId,
    desc: false,
    skip: 0,
    limit: 10,
  });
  const lastTurn = turns[turns.length - 1];
  expect([
    response.kind === EGatewayResponseKind.ANSWER ? response.text : response.kind,
    [lastTurn?.role, lastTurn?.parts, lastTurn?.modelId],
    storedRun?.status,
  ]).toEqual([
    "Your order arrives Friday.",
    [ETurnRole.ASSISTANT, [{
      kind: EPartKind.TEXT,
      text: "Your order arrives Friday.",
    }], storedRun?.request.modelId],
    ERunStatus.DONE,
  ]);
});
