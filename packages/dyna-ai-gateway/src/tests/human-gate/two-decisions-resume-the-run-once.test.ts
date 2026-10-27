import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {refundTool} from "../internal/samples/tools";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  CANCEL_REJECTION_TEXT,
  cancelOrderTool,
  gatewayConfigParallelApprovals,
} from "./parallel-approvals.config";

/**
 * A pause of two envelopes takes one decision per `callId`, in any order (D102): APPROVE runs the refund, REJECT writes
 * the cancellation's own rejection text with the human's reason (D87). The thread holds both results in request order, and
 * the model is called once after the resume.
 */
test("two decisions, APPROVE and REJECT, resume the run once; both results land in request order", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigParallelApprovals, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCalls: [
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-1",
        toolName: refundTool.name,
        input: {amount: 500},
      },
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-2",
        toolName: cancelOrderTool.name,
        input: {orderId: "A-1"},
      },
    ],
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 and cancel order A-1",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5376681234513,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  llmClient.enqueueRunStep({text: "Refunded 500; the order stays."});
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [
      {
        callId: "call-2",
        action: EResumeAction.REJECT,
        text: "the customer keeps it",
      },
      {
        callId: "call-1",
        action: EResumeAction.APPROVE,
      },
    ],
  }).response;

  const results = await loadToolResults({
    config: gatewayConfigParallelApprovals,
    threadId: paused.threadId,
  });
  expect([
    response.kind,
    results.map(part => [part.callId, part.rejected ?? false, part.output]),
    llmClient.runCalls.length,
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [
      ["call-1", false, {refunded: 500}],
      ["call-2", true, `${CANCEL_REJECTION_TEXT} Reason: the customer keeps it`],
    ],
    2,
  ]);
});
