import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
} from "../..";
import {ASK_USER_QUESTION_TOOL_NAME} from "../../internal";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigDoomedResume,
  screenCalls,
} from "./doomed-resume.config";
import {whichInvoiceQuestions} from "./user-question.config";

/**
 * A resume the gate will refuse (here: the run was cancelled meanwhile) is refused before the answer's free text is screened:
 * the input rules, and with them a judge call, run for answers that can go through only. The prompt was screened once at the start.
 */
test("an answer to a cancelled run is a 409 and the input rules do not run for it", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDoomedResume, {llmClient: () => llmClient});
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
      code: 5375387198817,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  await gateway.cancelRun({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
  });
  const screenedBefore = screenCalls.count;

  const resume = gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.ANSWER,
      answers: [{
        question: "Pick the invoice",
        selected: [],
        freeText: "The second one",
      }],
    }],
  }).response;

  await expect(resume).rejects.toMatchObject({
    code: 5372577355257,
    status: 409,
  });
  expect([screenedBefore, screenCalls.count]).toEqual([1, 1]);
});
