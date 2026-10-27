import {
  IUserAnswer,
  TGatewayResponse,
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  EPauseKind,
  EResumeAction,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  CUSTOMER_POSTCODE,
  gatewayConfigSupportShop,
  refundOrderTool,
  verifyCustomerTool,
} from "./support-shop.real.config";

/**
 * The question gate: a refund request that names no order cannot proceed, so the model asks through `ask_user_question` and the
 * run pauses with the question (the orders as options) instead of a guess. The answer picks order 1002. 19 EUR is above the
 * verification threshold, so the model asks the postcode next (a second question, or the same call when it batched both) and
 * verifies; 19 is under the approval threshold, so the refund then runs directly and the run answers. The test answers every
 * question pause: an option naming 1002 where there are options, the postcode where there are none. Up to five model calls.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */

const CHOSEN_ORDER = "1002";

/** Picks the option that names the chosen order where the question has options; a question without options asks the postcode. */
const answerWithChosenOrder = (questions: Array<{text: string; options?: string[]}>): IUserAnswer[] =>
  questions.map(question => {
    const option = (question.options ?? []).find(candidate => candidate.includes(CHOSEN_ORDER));
    return {
      question: question.text,
      selected: option ? [option] : [],
      ...option ? {} : {freeText: CUSTOMER_POSTCODE},
    };
  });

describeWithProvider(EModelProvider.OPENAI)("AIGateway — a refund without an order asks the customer, real provider", () => {
  test("a refund that names no order pauses with a user question; answered with 1002 and the postcode, it refunds 19 and answers", async () => {
    const gateway = new AIGateway(gatewayConfigSupportShop);

    const paused = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "I want a refund.",
      kbFilters: noKb,
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected PAUSED, got ${paused.kind}: ${JSON.stringify(paused)}`);
    if (paused.envelopes[0].kind !== EPauseKind.USER_QUESTION) throw new Error(`Expected a USER_QUESTION pause, got ${paused.envelopes[0].kind}`);

    let response: TGatewayResponse = paused;
    let questionPauses = 0;
    while (response.kind === EGatewayResponseKind.PAUSED && response.envelopes[0].kind === EPauseKind.USER_QUESTION && questionPauses < 3) {
      questionPauses++;
      response = await gateway.resume({
        userContext: sampleUserContext,
        runId: response.envelopes[0].runId,
        pauseId: response.envelopes[0].pauseId,
        decisions: [{
          action: EResumeAction.ANSWER,
          answers: answerWithChosenOrder(response.envelopes[0].userQuestions.questions),
        }],
      }).response;
    }

    const toolResults = await loadToolResults({
      config: gatewayConfigSupportShop,
      threadId: paused.threadId,
    });
    const refundResults = toolResults.filter(part => part.toolName === refundOrderTool.name);
    const verifyResults = toolResults.filter(part => part.toolName === verifyCustomerTool.name);
    expect([
      paused.envelopes[0].userQuestions.questions.length > 0,
      verifyResults.map(part => part.output),
      response.kind,
      refundResults.map(part => part.output),
    ]).toEqual([
      true,
      [{
        orderId: CHOSEN_ORDER,
        verified: true,
      }],
      EGatewayResponseKind.ANSWER,
      [{
        orderId: CHOSEN_ORDER,
        refunded: 19,
        status: "refunded",
      }],
    ]);
  });
});
