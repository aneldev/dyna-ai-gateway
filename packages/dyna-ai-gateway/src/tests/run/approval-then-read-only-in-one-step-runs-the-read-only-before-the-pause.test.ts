import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EPauseKind,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {refundTool} from "../internal/samples/tools";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigParallelTools,
  lookupOrderTool,
} from "./parallel-tools.config";

/**
 * One step asks for a tool that needs approval and then a read-only tool. On a parallel profile (the default, D101) every
 * allowed call of the step runs before the pause, so the read-only call behind the pending one has its result stored while
 * the run waits. APPROVE runs the pending call only, and the thread holds both results.
 */
test("the read-only call behind an approval call runs before the pause; the resume runs the approved call only", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigParallelTools, {llmClient: () => llmClient});
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
        toolName: lookupOrderTool.name,
        input: {orderId: "A-1"},
      },
    ],
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 and look up order A-1",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5376561294755,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const resultsWhilePaused = await loadToolResults({
    config: gatewayConfigParallelTools,
    threadId: paused.threadId,
  });

  llmClient.enqueueRunStep({text: "Refunded 500; order A-1 totals 42."});
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;

  const resultsAfter = await loadToolResults({
    config: gatewayConfigParallelTools,
    threadId: paused.threadId,
  });
  expect([
    paused.envelopes[0].kind === EPauseKind.TOOL_APPROVAL && paused.envelopes[0].toolCall.callId,
    resultsWhilePaused.map(part => part.callId),
    response.kind,
    resultsAfter.map(part => [part.callId, part.output]),
  ]).toEqual([
    "call-1",
    ["call-2"],
    EGatewayResponseKind.ANSWER,
    [
      ["call-2", {
        orderId: "A-1",
        total: 42,
      }],
      ["call-1", {refunded: 500}],
    ],
  ]);
});
