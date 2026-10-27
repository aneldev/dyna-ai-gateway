import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  cancelExecutions,
  cancelOrderTool,
  gatewayConfigParallelApprovals,
} from "./parallel-approvals.config";

/**
 * A pause of two envelopes is answered all or nothing (D102). A resume that leaves an envelope without a decision, sends a
 * decision without `callId`, or names a call the pause does not carry is a 400; the run stays PAUSED, no tool runs, and the
 * full set of decisions then goes through.
 */
test("a resume that does not answer every envelope is a 400 and the run stays paused", async () => {
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
      code: 5376681234537,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const cancellationsBefore = cancelExecutions.count;
  // One at a time: two resumes at once would meet the thread's lease (D77) instead of the decision check
  const refuse = (decisions: Parameters<AIGateway["resume"]>[0]["decisions"]): Promise<unknown> => gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions,
  }).response.then(() => null, (error: {code: number; status: number}) => [error.status, error.code]);
  const refusals = [
    await refuse([{
      callId: "call-1",
      action: EResumeAction.APPROVE,
    }]),
    await refuse([{action: EResumeAction.APPROVE}]),
    await refuse([
      {
        callId: "call-1",
        action: EResumeAction.APPROVE,
      },
      {
        callId: "call-9",
        action: EResumeAction.APPROVE,
      },
    ]),
  ];
  const stillPaused = await gatewayConfigParallelApprovals.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });

  llmClient.enqueueRunStep({text: "Done."});
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [
      {
        callId: "call-1",
        action: EResumeAction.APPROVE,
      },
      {
        callId: "call-2",
        action: EResumeAction.APPROVE,
      },
    ],
  }).response;

  expect([
    refusals,
    stillPaused?.status,
    cancelExecutions.count - cancellationsBefore,
    response.kind,
  ]).toEqual([
    [
      [400, 5376634521043],
      [400, 5376634521029],
      [400, 5376634521029],
    ],
    ERunStatus.PAUSED,
    1,
    EGatewayResponseKind.ANSWER,
  ]);
});
