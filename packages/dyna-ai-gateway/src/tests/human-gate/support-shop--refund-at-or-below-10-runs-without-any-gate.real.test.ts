import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigSupportShop,
  refundOrderTool,
} from "./support-shop.real.config";

/**
 * Both thresholds are per call, on the parsed input: a partial refund of 8 EUR is at or below the verification threshold (10) and
 * the approval threshold (50), so `refund_order` runs with no question, no verification and no pause, and the run answers in one go.
 * The same tool asks for the postcode on 19 and pauses on 349 in the sibling tests; nothing but the amount differs.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — a refund at or below both thresholds, real provider", () => {
  test("a refund of 8 runs without any gate; the run answers and the tool refunded 8", async () => {
    const gateway = new AIGateway(gatewayConfigSupportShop);

    const response = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Refund 8 EUR on order 1002, the phone case has a scratch.",
      kbFilters: noKb,
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    const toolResults = await loadToolResults({
      config: gatewayConfigSupportShop,
      threadId: response.threadId,
    });
    const refundResults = toolResults.filter(part => part.toolName === refundOrderTool.name);
    expect([
      response.kind,
      refundResults.map(part => part.output),
    ]).toEqual([
      EGatewayResponseKind.ANSWER,
      [{
        orderId: "1002",
        refunded: 8,
        status: "refunded",
      }],
    ]);
  });
});
