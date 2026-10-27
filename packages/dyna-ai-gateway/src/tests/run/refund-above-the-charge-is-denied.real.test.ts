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
  CHARGE_AMOUNT,
  gatewayConfigRefundAbove100NeedsApproval,
  refundTool,
} from "./refund-above-100-needs-approval.real.config";

/**
 * The policy's third verdict (D87): a refund above the charge is denied before it runs. The model is not told the limit, so it
 * calls the tool; the denial comes back as the tool's result, the tool never executed, and the run finishes with an answer
 * instead of pausing or retrying. Asserted on structure: the kind, the stored denied result, no execution.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — a tool call the policy denies, real provider", () => {
  test("a refund above the charge is denied: the tool does not run, the model reads the denial and answers", async () => {
    const gateway = new AIGateway(gatewayConfigRefundAbove100NeedsApproval);

    const response = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: `Refund ${CHARGE_AMOUNT * 5} EUR to the customer.`,
      kbFilters: noKb,
    }).response;

    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected an answer, got ${response.kind}: ${JSON.stringify(response)}`);
    const toolResults = await loadToolResults({
      config: gatewayConfigRefundAbove100NeedsApproval,
      threadId: response.threadId,
    });
    expect(toolResults.map(part => [part.toolName, part.denied ?? false])).toEqual([[refundTool.name, true]]);
    expect(String(toolResults[0]?.output)).toContain("above the charge");
  });
});
