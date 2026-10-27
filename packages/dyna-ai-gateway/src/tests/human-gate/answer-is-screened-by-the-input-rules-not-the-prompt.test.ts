import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
} from "../..";
import {ASK_USER_QUESTION_TOOL_NAME} from "../../internal";

import {noFurnitureRule} from "../guardrails/input-rule-blocks-prompt.config";
import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {whichInvoiceQuestions} from "./user-question.config";
import {gatewayConfigUserQuestionWithInputRule} from "./user-question-with-input-rule.config";

/**
 * The app's input rules get the answer's free text as their prompt (D71): a prompt the topic filter lets through pauses on a
 * question; an answer that trips the filter is refused with the rule's issue, and the run stays PAUSED for another answer.
 */
test("an app input rule screens the free text of the answer; an answer it rejects leaves the run paused", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigUserQuestionWithInputRule, {llmClient: () => llmClient});
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
      code: 5375186073369,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  const response = await gateway.resume({
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
  }).response;

  const run = await gatewayConfigUserQuestionWithInputRule.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.ruleName, issue.code]),
    run?.status,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[noFurnitureRule.name, "topic_blocked"]],
    ERunStatus.PAUSED,
  ]);
});
