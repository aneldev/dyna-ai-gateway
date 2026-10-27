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
} from "./support-shop.real.config";

/**
 * The human has the last word on the input, not only yes or no: a refund of 349 (above the approval threshold) pauses with the tool
 * call in the envelope; resumed with an edited input of 300, the tool runs with the human's 300, not the model's 349, and the stored
 * result says so. 349 is also above the verification threshold, so the model first asks the customer for the postcode (a user
 * question, answered here with the right one) and verifies; that step is the subject of the sibling test and is only passed through.
 * Four model calls: the listing, the postcode question, the verification and refund step, the answer.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — a refund above the threshold is edited by the human, real provider", () => {
  test("a refund of 349 pauses for approval; resumed with an edited input of 300, the tool refunds 300", async () => {
    const gateway = new AIGateway(gatewayConfigSupportShop);

    const askedPostcode = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Refund order 1003 in full, the monitor never arrived.",
      kbFilters: noKb,
    }).response;
    if (askedPostcode.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected PAUSED, got ${askedPostcode.kind}: ${JSON.stringify(askedPostcode)}`);
    if (askedPostcode.envelopes[0].kind !== EPauseKind.USER_QUESTION) throw new Error(`Expected a USER_QUESTION pause, got ${askedPostcode.envelopes[0].kind}`);

    const paused = await gateway.resume({
      userContext: sampleUserContext,
      runId: askedPostcode.envelopes[0].runId,
      pauseId: askedPostcode.envelopes[0].pauseId,
      decisions: [{
        action: EResumeAction.ANSWER,
        answers: answerEveryQuestionWith(askedPostcode.envelopes[0].userQuestions.questions, CUSTOMER_POSTCODE),
      }],
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected PAUSED, got ${paused.kind}: ${JSON.stringify(paused)}`);
    if (paused.envelopes[0].kind !== EPauseKind.TOOL_APPROVAL) throw new Error(`Expected a TOOL_APPROVAL pause, got ${paused.envelopes[0].kind}`);

    const response = await gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{
        action: EResumeAction.EDIT,
        editedInput: {
          orderId: "1003",
          amount: 300,
          reason: "Monitor never arrived; shipping cost kept",
        },
      }],
    }).response;

    const toolResults = await loadToolResults({
      config: gatewayConfigSupportShop,
      threadId: paused.threadId,
    });
    const refundResults = toolResults.filter(part => part.toolName === refundOrderTool.name);
    expect([
      paused.envelopes[0].toolCall.toolName,
      response.kind,
      refundResults.map(part => part.output),
    ]).toEqual([
      refundOrderTool.name,
      EGatewayResponseKind.ANSWER,
      [{
        orderId: "1003",
        refunded: 300,
        status: "refunded",
      }],
    ]);
  });
});
