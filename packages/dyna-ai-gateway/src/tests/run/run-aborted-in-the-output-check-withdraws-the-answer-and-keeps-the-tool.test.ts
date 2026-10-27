import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  ELLMClientEventKind,
  EPartKind,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigRunOutputCheckAbort,
  logEventTool,
  runOutputCheckAbort,
} from "./run-output-check-abort.config";

/**
 * A run ran a tool and streamed its final answer; the caller presses "stop" while the output rules check it. The call is FAILED,
 * the stream withdraws the answer (ANSWER_WITHDRAWN with the abort's issue), the tool call and its real result stay in the
 * thread, and the final text is not stored: the thread ends with the tool turn, as for a blocked answer (D70).
 */
test("a run aborted during the output check withdraws the answer and keeps the tool call and its result", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigRunOutputCheckAbort, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: logEventTool.name,
      input: {name: "signup"},
    },
  });
  llmClient.enqueueRunStep({text: "Logged."});
  const controller = new AbortController();
  runOutputCheckAbort.controller = controller;

  const kinds: ELLMClientEventKind[] = [];
  let response;
  try {
    const call = gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Log the signup",
      kbFilters: noKb,
      abortSignal: controller.signal,
    });
    for await (const event of call.events) kinds.push(event.kind);
    response = await call.response;
  }
  finally {
    runOutputCheckAbort.controller = undefined;
  }

  const turns = await gatewayConfigRunOutputCheckAbort.threadStore.repository.loadTurns({
    tenantId: sampleUserContext.tenantId,
    threadId: response.threadId ?? "",
    desc: false,
    skip: 0,
    limit: 10,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigRunOutputCheckAbort,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => issue.code),
    kinds[kinds.length - 1],
    turns.map(turn => [turn.role, turn.parts.map(part => part.kind)]),
    toolResults.map(part => [part.callId, part.output, part.failed]),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [CALL_ABORTED_ISSUE_CODE],
    ELLMClientEventKind.ANSWER_WITHDRAWN,
    [[ETurnRole.USER, [EPartKind.TEXT]], [ETurnRole.ASSISTANT, [EPartKind.TOOL_CALL]], [ETurnRole.TOOL, [EPartKind.TOOL_RESULT]]],
    [["call-1", {logged: true}, undefined]],
  ]);
});
