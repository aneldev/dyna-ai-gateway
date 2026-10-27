import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EPauseKind,
  EResumeAction,
  ERunStatus,
  EThreadStatus,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {getCurrentTimeTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigReviewAnswers} from "./review-answers.config";

/**
 * APPROVE on a reviewed answer (D99) delivers it as the run would have without the review: no model call (nothing more is
 * enqueued), the answer becomes the last assistant turn of the thread, the response is the ANSWER with the run's usage, the
 * run is DONE with its pending envelope and its stored answer cleared, and the thread is open again.
 */
test("an approved answer is stored as the assistant turn and returned as the run's ANSWER", async () => {
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
      toolName: getCurrentTimeTool.name,
      input: {},
    },
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
  }).response;

  const storedRun = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigReviewAnswers.threadStore.repository.loadThread({
    tenantId: sampleUser.tenantId,
    threadId: paused.threadId,
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
    paused.envelopes[0].kind,
    response.kind,
    response.kind === EGatewayResponseKind.ANSWER ? [response.text, response.citations, response.issues] : null,
    [lastTurn?.role, lastTurn?.parts],
    [storedRun?.status, storedRun?.pending, storedRun?.answer],
    thread?.status,
  ]).toEqual([
    EPauseKind.RESULT_REVIEW,
    EGatewayResponseKind.ANSWER,
    ["It is noon.", [], []],
    [ETurnRole.ASSISTANT, [{
      kind: EPartKind.TEXT,
      text: "It is noon.",
    }]],
    [ERunStatus.DONE, undefined, undefined],
    EThreadStatus.OPEN,
  ]);
});
