import {
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
  gatewayConfigRefundAbove100NeedsApproval,
  refundTool,
} from "./refund-above-100-needs-approval.real.config";

/**
 * A tool's own `policy` decides the pause: a refund of 500 (above 100, within the charge) pauses for approval with the tool call in the envelope;
 * approved, the tool runs with that input and the stored result carries the refunded amount.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — a tool with a policy predicate, real provider", () => {
  test("a refund of 500 pauses for approval; approved, the tool refunds 500 and the run finishes", async () => {
    const gateway = new AIGateway(gatewayConfigRefundAbove100NeedsApproval);

    const paused = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Refund 500 EUR to the customer.",
      kbFilters: noKb,
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected PAUSED, got ${paused.kind}: ${JSON.stringify(paused)}`);
    if (paused.envelopes[0].kind !== EPauseKind.TOOL_APPROVAL) throw new Error(`Expected a TOOL_APPROVAL pause, got ${paused.envelopes[0].kind}`);

    const response = await gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
    }).response;

    const toolResults = await loadToolResults({
      config: gatewayConfigRefundAbove100NeedsApproval,
      threadId: paused.threadId,
    });
    expect([
      paused.envelopes[0].toolCall.toolName,
      response.kind,
      toolResults.map(part => part.output),
    ]).toEqual([
      refundTool.name,
      EGatewayResponseKind.ANSWER,
      [{refunded: 500}],
    ]);
  });
});
