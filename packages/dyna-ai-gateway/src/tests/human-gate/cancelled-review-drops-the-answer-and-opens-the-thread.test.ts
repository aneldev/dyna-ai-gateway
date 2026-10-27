import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
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
 * A user gives up on a review pause (D99): `cancelRun` cancels it like any pause. There is no tool call to close, so the thread
 * keeps the tool turns it had and gains nothing, the answer is gone, the run is CANCELLED, the thread is open and takes a
 * new call.
 */
test("a cancelled review drops the answer: no assistant text, run CANCELLED, thread open and usable again", async () => {
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

  await gateway.cancelRun({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
  });

  const run = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigReviewAnswers.threadStore.repository.loadThread({
    tenantId: sampleUser.tenantId,
    threadId: paused.threadId,
  });
  llmClient.enqueueRunStep({text: "Never mind then."});
  const next = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    threadId: paused.threadId,
    prompt: "Never mind",
    kbFilters: noKb,
  }).response;
  const turns = await gatewayConfigReviewAnswers.threadStore.repository.loadTurns({
    tenantId: sampleUser.tenantId,
    threadId: paused.threadId,
    desc: false,
    skip: 0,
    limit: 10,
  });
  expect([
    [run?.status, run?.pending],
    thread?.status,
    turns.map(turn => [turn.role, turn.parts.map(part => part.kind)]),
    next.kind,
  ]).toEqual([
    [ERunStatus.CANCELLED, undefined],
    EThreadStatus.OPEN,
    [
      [ETurnRole.USER, [EPartKind.TEXT]],
      [ETurnRole.ASSISTANT, [EPartKind.TOOL_CALL]],
      [ETurnRole.TOOL, [EPartKind.TOOL_RESULT]],
      [ETurnRole.USER, [EPartKind.TEXT]],
    ],
    EGatewayResponseKind.PAUSED,
  ]);
});
