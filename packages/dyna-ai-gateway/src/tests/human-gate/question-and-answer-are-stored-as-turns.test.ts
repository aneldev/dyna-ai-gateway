import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ETurnRole,
  BUILT_IN_TOOL_NAMES,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigUserQuestion,
  whichInvoiceAnswers,
  whichInvoiceQuestions,
} from "./user-question.config";

/**
 * A user question and its answer become thread turns like any tool round (D62): the assistant turn with the `dyna_aigw_ask_user_question`
 * call, the tool turn with the answers as the call's result, then the assistant's answer. A chat UI renders them from there.
 */
test("the model's question and the user's answer are stored as a tool call and its result", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigUserQuestion, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-ask",
      toolName: BUILT_IN_TOOL_NAMES.ASK_USER_QUESTION,
      input: whichInvoiceQuestions,
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Send the overdue invoice",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5375185962841,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  llmClient.enqueueRunStep({text: "Invoice 4521 is sent."});
  await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.ANSWER,
      answers: whichInvoiceAnswers,
    }],
  }).response;

  const turns = await gatewayConfigUserQuestion.threadStore.repository.loadTurns({
    tenantId: sampleUser.tenantId,
    threadId: paused.threadId,
    desc: false,
    skip: 0,
    limit: 10,
  });
  expect(turns.map(turn => [turn.role, turn.parts.map(part => part.kind === EPartKind.TOOL_RESULT ? [part.toolName, part.output] : part.kind)])).toEqual([
    [ETurnRole.USER, [EPartKind.TEXT]],
    [ETurnRole.ASSISTANT, [EPartKind.TOOL_CALL]],
    [ETurnRole.TOOL, [[BUILT_IN_TOOL_NAMES.ASK_USER_QUESTION, {answers: whichInvoiceAnswers}]]],
    [ETurnRole.ASSISTANT, [EPartKind.TEXT]],
  ]);
});
