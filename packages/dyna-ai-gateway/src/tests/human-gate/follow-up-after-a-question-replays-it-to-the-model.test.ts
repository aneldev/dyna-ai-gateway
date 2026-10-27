import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EMessageRole,
  EPartKind,
  EResumeAction,
} from "../..";
import {ASK_USER_QUESTION_TOOL_NAME} from "../../internal";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigUserQuestion,
  whichInvoiceAnswers,
  whichInvoiceQuestions,
} from "./user-question.config";

/**
 * The next call on the thread sends the question round to the model as history: the `ask_user_question` call, its result
 * with the answers, the assistant's answer. The model keeps what the user said; a provider sees a complete tool round.
 */
test("a follow-up on the thread sends the question, the answers and the reply to the model as history", async () => {
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
      toolName: ASK_USER_QUESTION_TOOL_NAME,
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
      code: 5375185962853,
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

  llmClient.enqueueRunStep({text: "Yes, 4521 went out."});
  await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    threadId: paused.threadId,
    prompt: "Did it go out?",
    kbFilters: noKb,
  }).response;

  const followUp = llmClient.runCalls[llmClient.runCalls.length - 1];
  const history = (followUp?.request.messages ?? []).map(message => [
    message.role,
    message.parts.map(part => part.kind === EPartKind.TOOL_RESULT ? [part.toolName, part.output] : part.kind),
  ]);
  expect(history).toEqual([
    [EMessageRole.USER, [EPartKind.TEXT]],
    [EMessageRole.ASSISTANT, [EPartKind.TOOL_CALL]],
    [EMessageRole.TOOL, [[ASK_USER_QUESTION_TOOL_NAME, {answers: whichInvoiceAnswers}]]],
    [EMessageRole.ASSISTANT, [EPartKind.TEXT]],
    [EMessageRole.USER, [EPartKind.TEXT]],
  ]);
});
