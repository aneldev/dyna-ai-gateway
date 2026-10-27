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
  cancelOrderTool,
  gatewayConfigSequentialApprovals,
} from "./parallel-approvals.config";

/**
 * On a profile with `parallelToolCalls: false` (D101) the calls of a step are decided one after the other: two approvals in
 * one step pause twice, one envelope each, and each resume takes its one decision without `callId`. The results land in
 * request order all the same.
 */
test("a sequential profile pauses twice for two approvals of one step, one envelope each", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSequentialApprovals, {llmClient: () => llmClient});
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
  const firstPause = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 and cancel order A-1",
    kbFilters: noKb,
  }).response;
  if (firstPause.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5376681234563,
      message: `Test setup: expected PAUSED, got ${firstPause.kind}`,
      data: {firstPause},
    });
  }

  const secondPause = await gateway.resume({
    userContext: sampleUserContext,
    runId: firstPause.envelopes[0].runId,
    pauseId: firstPause.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;
  if (secondPause.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5376681234575,
      message: `Test setup: expected a second PAUSED, got ${secondPause.kind}`,
      data: {secondPause},
    });
  }
  llmClient.enqueueRunStep({text: "Refunded 500; order A-1 cancelled."});
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: secondPause.envelopes[0].runId,
    pauseId: secondPause.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;

  const results = await loadToolResults({
    config: gatewayConfigSequentialApprovals,
    threadId: firstPause.threadId,
  });
  const pausedCallIds = (paused: typeof firstPause): Array<string | null> =>
    paused.envelopes.map(envelope => "callId" in envelope ? envelope.callId : null);
  expect([
    pausedCallIds(firstPause),
    pausedCallIds(secondPause),
    response.kind,
    results.map(part => [part.callId, part.output]),
  ]).toEqual([
    ["call-1"],
    ["call-2"],
    EGatewayResponseKind.ANSWER,
    [
      ["call-1", {refunded: 500}],
      ["call-2", {cancelled: "A-1"}],
    ],
  ]);
});
