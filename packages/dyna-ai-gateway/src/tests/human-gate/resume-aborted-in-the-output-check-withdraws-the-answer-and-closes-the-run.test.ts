import {dynaError} from "dyna-error";

import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  ELLMClientEventKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
  EThreadStatus,
  TGatewayResponse,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  abortedResumeOutputCheck,
  gatewayConfigAbortedResumeOutputCheck,
  quickRefundTool,
} from "./aborted-resume-output-check.config";

/**
 * The approved tool ran and the resumed run streamed its final answer; the caller presses "stop" while the output rules check
 * it. The resume is FAILED with the abort's issue, the stream withdraws the answer (ANSWER_WITHDRAWN), the tool call keeps its
 * real result and the final text is not stored; the run is FAILED and the thread open again.
 */
test("a resume aborted during the output check withdraws the answer, keeps the tool result and closes the run", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAbortedResumeOutputCheck, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: quickRefundTool.name,
      input: {amount: 500},
    },
  });
  llmClient.enqueueRunStep({text: "Refunded."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 to the customer",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5376412760095,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const controller = new AbortController();
  abortedResumeOutputCheck.controller = controller;

  const kinds: ELLMClientEventKind[] = [];
  let resumed: TGatewayResponse;
  try {
    const call = gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
      abortSignal: controller.signal,
    });
    for await (const event of call.events) kinds.push(event.kind);
    resumed = await call.response;
  }
  finally {
    abortedResumeOutputCheck.controller = undefined;
  }

  const run = await gatewayConfigAbortedResumeOutputCheck.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigAbortedResumeOutputCheck.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: paused.threadId,
  });
  const turns = await gatewayConfigAbortedResumeOutputCheck.threadStore.repository.loadTurns({
    tenantId: sampleUserContext.tenantId,
    threadId: paused.threadId,
    desc: false,
    skip: 0,
    limit: 10,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigAbortedResumeOutputCheck,
    threadId: paused.threadId,
  });
  expect([
    resumed.kind,
    resumed.kind === EGatewayResponseKind.FAILED && resumed.issues.map(issue => issue.code),
    kinds[kinds.length - 1],
    run?.status,
    thread?.status,
    turns.map(turn => [turn.role, turn.parts.map(part => part.kind)]),
    toolResults.map(part => [part.callId, part.output, part.failed]),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [CALL_ABORTED_ISSUE_CODE],
    ELLMClientEventKind.ANSWER_WITHDRAWN,
    ERunStatus.FAILED,
    EThreadStatus.OPEN,
    [[ETurnRole.USER, [EPartKind.TEXT]], [ETurnRole.ASSISTANT, [EPartKind.TOOL_CALL]], [ETurnRole.TOOL, [EPartKind.TOOL_RESULT]]],
    [["call-1", {refunded: 500}, undefined]],
  ]);
});
