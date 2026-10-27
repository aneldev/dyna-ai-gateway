import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
  EUserQuestionMode,
  IUserQuestions,
} from "../..";
import {ASK_USER_QUESTION_TOOL_NAME} from "../../internal";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigSupportShop,
  noPaymentDataRule,
} from "./support-shop.real.config";


/** The question the model asks when the request names no order, as the deterministic tests script it. */
const whichOrderQuestions: IUserQuestions = {
  title: "Which order should be refunded?",
  description: "You have three orders.",
  questions: [{
    text: "Which order?",
    mode: EUserQuestionMode.RADIO,
    options: ["1001 — Wireless headphones (89 EUR)", "1002 — Phone case (19 EUR)", "1003 — 27-inch monitor (349 EUR)"],
    freeOption: true,
  }],
};


/**
 * The guardrail also guards the question gate (D71): the free text of an answer is screened by the input rules like a prompt.
 * The scripted model asks which order; the customer types a card number into the answer. The resume FAILS with the rule's
 * issue, the run stays PAUSED and the model does not continue. A clean answer then continues the run: the scripted next step
 * answers, and the run finishes.
 */
test("an answer whose free text carries a card number is refused and the run stays paused; a clean answer continues it", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSupportShop, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-ask",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      input: whichOrderQuestions,
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "I want a refund.",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5375523019683,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const question = whichOrderQuestions.questions[0]?.text ?? "";

  const refused = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.ANSWER,
      answers: [{
        question,
        selected: [],
        freeText: "The phone case, refund it to card 4111 1111 1111 1111",
      }],
    }],
  }).response;
  const runAfterRefusal = await gatewayConfigSupportShop.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });

  llmClient.enqueueRunStep({text: "Order 1002 is refunded."});
  const continued = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.ANSWER,
      answers: [{
        question,
        selected: ["1002 — Phone case (19 EUR)"],
      }],
    }],
  }).response;

  expect([
    refused.kind,
    refused.kind === EGatewayResponseKind.FAILED && refused.issues.map(issue => [issue.ruleName, issue.code]),
    runAfterRefusal?.status,
    continued.kind,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[noPaymentDataRule.name, "payment_data_in_chat"]],
    ERunStatus.PAUSED,
    EGatewayResponseKind.ANSWER,
  ]);
});
