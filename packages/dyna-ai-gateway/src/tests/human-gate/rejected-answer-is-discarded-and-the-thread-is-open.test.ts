import {
  AIGateway,
  ILLMClientEvent,
  ANSWER_REJECTED_ISSUE_CODE,
  EGatewayResponseKind,
  EIssueSeverity,
  ELLMClientEventKind,
  EPartKind,
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
 * REJECT on a reviewed answer (D99) drops it: the thread keeps the tool turns only (the tools did run) and gains no assistant
 * text, the run is CANCELLED with its envelope and stored answer cleared, the thread is open again, the response is FAILED
 * with the reviewer's reason and the `answer_rejected` issue, and the stream withdraws the draft the client rendered.
 */
test("a rejected answer is dropped: no turn, run CANCELLED, thread OPEN, FAILED with the reason, ANSWER_WITHDRAWN on the stream", async () => {
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

  const call = gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.REJECT,
      text: "Wrong timezone.",
    }],
  });
  const events: ILLMClientEvent[] = [];
  for await (const event of call.events) events.push(event);
  const response = await call.response;

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
  expect([
    response,
    [storedRun?.status, storedRun?.pending, storedRun?.answer],
    thread?.status,
    turns.map(turn => turn.role),
    events.map(event => [event.kind, event.issues?.map(issue => issue.code)]),
  ]).toEqual([
    {
      kind: EGatewayResponseKind.FAILED,
      threadId: paused.threadId,
      reason: "Wrong timezone.",
      issues: [{
        code: ANSWER_REJECTED_ISSUE_CODE,
        message: "Wrong timezone.",
        severity: EIssueSeverity.ERROR,
      }],
    },
    [ERunStatus.CANCELLED, undefined, undefined],
    EThreadStatus.OPEN,
    [ETurnRole.USER, ETurnRole.ASSISTANT, ETurnRole.TOOL],
    [[ELLMClientEventKind.ANSWER_WITHDRAWN, [ANSWER_REJECTED_ISSUE_CODE]]],
  ]);
});
