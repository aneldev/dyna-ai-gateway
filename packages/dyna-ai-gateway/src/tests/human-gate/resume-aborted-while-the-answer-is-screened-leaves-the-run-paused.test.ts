import {dynaError} from "dyna-error";

import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
  EThreadStatus,
  TGatewayResponse,
} from "../..";
import {ASK_USER_QUESTION_TOOL_NAME} from "../../internal";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  answerScreenAbort,
  gatewayConfigAbortedAnswerScreen,
} from "./aborted-answer-screen.config";
import {whichInvoiceQuestions} from "./user-question.config";

/**
 * The caller aborts a resume while the answer's free text is still screened by the input rules: the response is FAILED with the
 * reason, and the run has not left PAUSED, so the user can answer again; the thread still waits for the human.
 */
test("a resume aborted while the answer is screened is FAILED and leaves the run paused", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAbortedAnswerScreen, {llmClient: () => llmClient});
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
      code: 5376412760025,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const controller = new AbortController();
  answerScreenAbort.controller = controller;

  let resumed: TGatewayResponse;
  try {
    resumed = await gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{
        action: EResumeAction.ANSWER,
        answers: [{
          question: "Pick the invoice",
          selected: [],
          freeText: "The one for the cupboards",
        }],
      }],
      abortSignal: controller.signal,
    }).response;
  }
  finally {
    answerScreenAbort.controller = undefined;
  }

  const run = await gatewayConfigAbortedAnswerScreen.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigAbortedAnswerScreen.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: paused.threadId,
  });
  expect([
    resumed.kind,
    resumed.kind === EGatewayResponseKind.FAILED && resumed.issues.map(issue => issue.code),
    run?.status,
    thread?.status,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [CALL_ABORTED_ISSUE_CODE],
    ERunStatus.PAUSED,
    EThreadStatus.AWAITING_HUMAN,
  ]);
});
