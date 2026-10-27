import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  EPauseKind,
  EResumeAction,
} from "../..";

import {answerEveryQuestionWith} from "../internal/utils/answerEveryQuestionWith";
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
 * Extra verification from the customer: a refund of 19 EUR is above the verification threshold (10), so the model does not refund
 * yet; it asks the customer for the postcode of the delivery address through `ask_user_question` (the run pauses), then calls
 * `verify_customer` with the answer, and only then `refund_order`. 19 is under the approval threshold (50), so no human pause
 * follows and the run answers. Asserted in order: the question pause, the verification result, the refund result, the answer.
 * Three model calls: the listing, the question, the verification and refund step.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — a refund above the verification threshold verifies the customer, real provider", () => {
  test("a refund of 19 asks for the postcode; answered correctly, verify_customer passes, the tool refunds 19 and the run answers", async () => {
    const gateway = new AIGateway(gatewayConfigSupportShop);

    const askedPostcode = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Refund order 1002 in full, the phone case arrived broken.",
      kbFilters: noKb,
    }).response;
    if (askedPostcode.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected PAUSED, got ${askedPostcode.kind}: ${JSON.stringify(askedPostcode)}`);
    if (askedPostcode.envelopes[0].kind !== EPauseKind.USER_QUESTION) throw new Error(`Expected a USER_QUESTION pause, got ${askedPostcode.envelopes[0].kind}`);

    const response = await gateway.resume({
      userContext: sampleUserContext,
      runId: askedPostcode.envelopes[0].runId,
      pauseId: askedPostcode.envelopes[0].pauseId,
      decisions: [{
        action: EResumeAction.ANSWER,
        answers: answerEveryQuestionWith(askedPostcode.envelopes[0].userQuestions.questions, CUSTOMER_POSTCODE),
      }],
    }).response;

    const toolResults = await loadToolResults({
      config: gatewayConfigSupportShop,
      threadId: askedPostcode.threadId,
    });
    const gatedResults = toolResults.filter(part => [verifyCustomerTool.name, refundOrderTool.name].includes(part.toolName));
    expect([
      askedPostcode.envelopes[0].userQuestions.questions.length > 0,
      response.kind,
      gatedResults.map(part => [part.toolName, part.output]),
    ]).toEqual([
      true,
      EGatewayResponseKind.ANSWER,
      [
        [verifyCustomerTool.name, {
          orderId: "1002",
          verified: true,
        }],
        [refundOrderTool.name, {
          orderId: "1002",
          refunded: 19,
          status: "refunded",
        }],
      ],
    ]);
  });
});
