import {dynaError} from "dyna-error";

import {
  AIGateway,
  DEFAULT_TOOL_REJECTION_TEXT,
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
  gatewayConfigParallelTools,
  lookupOrderTool,
} from "./parallel-tools.config";

/**
 * One step asks for a refund (needs approval) and then a read-only lookup. On a parallel profile (the default, D101) the
 * lookup runs before the pause, since every allowed call of the step does. The human rejects the refund: it is stored as
 * rejected with the rejection text and the human's reason, after the lookup's result, and the model answers on both.
 */
test("a rejected call is stored as rejected; its read-only sibling ran before the pause", async () => {
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
      code: 5375185962805,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  llmClient.enqueueRunStep({text: "No refund; order A-1 totals 42."});
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.REJECT,
      text: "Not eligible",
    }],
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigParallelTools,
    threadId: paused.threadId,
  });
  expect([response.kind, toolResults.map(part => [part.callId, part.rejected ?? false, part.output])]).toEqual([
    EGatewayResponseKind.ANSWER,
    [
      ["call-2", false, {
        orderId: "A-1",
        total: 42,
      }],
      ["call-1", true, `${DEFAULT_TOOL_REJECTION_TEXT} Reason: Not eligible`],
    ],
  ]);
});
