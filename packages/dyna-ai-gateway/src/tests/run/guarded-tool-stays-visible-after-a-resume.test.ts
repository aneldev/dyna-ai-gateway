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

import {gatewayConfigGuardedTools} from "./guarded-tools.config";
import {lookupOrderTool} from "./parallel-tools.config";

/**
 * The requirement of a guarded tool ran before a pause. After the resume the guarded tool is still visible and still runs:
 * what was executed is read from the stored run, not from the current invocation of the loop (D72, the M3.5 finding).
 * Here lookup_order runs, a large refund pauses, APPROVE runs it, and a small refund in the next step runs too.
 */
test("a guarded tool whose requirement ran before the pause is offered and runs after the resume", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigGuardedTools, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: lookupOrderTool.name,
      input: {orderId: "A-1"},
    },
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-2",
      toolName: refundTool.name,
      input: {amount: 500},
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Look up order A-1 and refund 500, then 20 more",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5375187736233,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-3",
      toolName: refundTool.name,
      input: {amount: 20},
    },
  });
  llmClient.enqueueRunStep({text: "Refunded 500 and 20."});
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigGuardedTools,
    threadId: paused.threadId,
  });
  expect([
    response.kind,
    toolResults.map(part => [part.callId, part.output]),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [
      ["call-1", {
        orderId: "A-1",
        total: 42,
      }],
      ["call-2", {refunded: 500}],
      ["call-3", {refunded: 20}],
    ],
  ]);
});
