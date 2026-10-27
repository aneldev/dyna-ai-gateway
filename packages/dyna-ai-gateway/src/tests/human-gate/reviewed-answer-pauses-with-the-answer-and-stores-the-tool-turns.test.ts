import {
  AIGateway,
  ILLMClientEvent,
  EGatewayResponseKind,
  ELLMClientEventKind,
  EPartKind,
  EPauseKind,
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
 * On a profile with `reviewAnswers` the finished run does not deliver its answer (D99): the run pauses with a RESULT_REVIEW
 * envelope, the answer is kept on the run for the decision (the stored envelope shows it to the reviewer, the asker's response
 * does not), the tool turns are stored (the tools did run) but no assistant text, the thread waits for a human, and the
 * stream ends with RUN_PAUSED without a tool call.
 */
test("a reviewed answer pauses the run with the answer on the run, not in the asker's response, and stores the tool turns only", async () => {
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

  const call = gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What time is it?",
    kbFilters: noKb,
  });
  const events: ILLMClientEvent[] = [];
  for await (const event of call.events) events.push(event);
  const response = await call.response;
  if (response.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected a pause, got ${response.kind}`);

  const storedRun = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: response.envelopes[0].runId,
  });
  const thread = await gatewayConfigReviewAnswers.threadStore.repository.loadThread({
    tenantId: sampleUser.tenantId,
    threadId: response.threadId,
  });
  const turns = await gatewayConfigReviewAnswers.threadStore.repository.loadTurns({
    tenantId: sampleUser.tenantId,
    threadId: response.threadId,
    desc: false,
    skip: 0,
    limit: 10,
  });
  const lastEvent = events[events.length - 1];

  expect([
    response.envelopes[0].kind,
    response.envelopes[0].kind === EPauseKind.RESULT_REVIEW ? response.envelopes[0].result : null,
    storedRun?.pending?.[0]?.kind === EPauseKind.RESULT_REVIEW ? storedRun.pending[0].result?.text : null,
    storedRun?.status,
    storedRun?.answer?.result.text,
    thread?.status,
    turns.map(turn => [turn.role, turn.parts.map(part => part.kind)]),
    [lastEvent?.kind, lastEvent?.toolCall],
  ]).toEqual([
    EPauseKind.RESULT_REVIEW,
    undefined,
    "It is noon.",
    ERunStatus.PAUSED,
    "It is noon.",
    EThreadStatus.AWAITING_HUMAN,
    [
      [ETurnRole.USER, [EPartKind.TEXT]],
      [ETurnRole.ASSISTANT, [EPartKind.TOOL_CALL]],
      [ETurnRole.TOOL, [EPartKind.TOOL_RESULT]],
    ],
    [ELLMClientEventKind.RUN_PAUSED, undefined],
  ]);
});
