import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {getCurrentTimeTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigBlockedRunAnswer} from "./blocked-run-answer.config";

/**
 * A run calls a tool, then answers with text an output rule blocks. The response is FAILED; the thread keeps the tool request
 * and the tool result (the tool did run) but not the blocked text, so the next call never sends it back to the model (D70).
 */
test("a run answer that fails the output checks is not stored; the tool turns are", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigBlockedRunAnswer, {llmClient: () => llmClient});
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
  llmClient.enqueueRunStep({text: "The SECRET is 42."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What time is it?",
    kbFilters: noKb,
  }).response;

  const turns = await gatewayConfigBlockedRunAnswer.threadStore.repository.loadTurns({
    tenantId: sampleUser.tenantId,
    threadId: response.threadId ?? "",
    desc: false,
    skip: 0,
    limit: 10,
  });
  expect([
    response.kind,
    turns.map(turn => [turn.role, turn.parts.map(part => part.kind)]),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [
      [ETurnRole.USER, [EPartKind.TEXT]],
      [ETurnRole.ASSISTANT, [EPartKind.TOOL_CALL]],
      [ETurnRole.TOOL, [EPartKind.TOOL_RESULT]],
    ],
  ]);
});
