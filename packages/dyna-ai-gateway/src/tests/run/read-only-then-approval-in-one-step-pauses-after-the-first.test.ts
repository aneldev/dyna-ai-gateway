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
 * One step asks for a read-only tool and then a tool that needs approval. Every allowed call of the step runs before the
 * pause (D101), so the read-only one runs and its result is stored before the pause; the approval pauses on the second call.
 * After APPROVE the second runs, and the thread holds both results.
 */
test("a read-only call before an approval call runs before the pause; the approved call runs on resume", async () => {
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
        toolName: lookupOrderTool.name,
        input: {orderId: "A-1"},
      },
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-2",
        toolName: refundTool.name,
        input: {amount: 500},
      },
    ],
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Look up order A-1 and refund 500",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5375185962793,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const resultsWhilePaused = await loadToolResults({
    config: gatewayConfigParallelTools,
    threadId: paused.threadId,
  });

  llmClient.enqueueRunStep({text: "Order A-1 totals 42; refunded 500."});
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
    "call-2",
    ["call-1"],
    EGatewayResponseKind.ANSWER,
    [
      ["call-1", {
        orderId: "A-1",
        total: 42,
      }],
      ["call-2", {refunded: 500}],
    ],
  ]);
});
