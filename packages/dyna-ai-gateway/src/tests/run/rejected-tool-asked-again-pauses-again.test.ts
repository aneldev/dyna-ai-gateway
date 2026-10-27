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

import {gatewayConfigParallelTools} from "./parallel-tools.config";

/**
 * The human rejects a refund and the model asks for the same refund again (real models often retry). The run pauses again on the
 * same run id with the new call; the first call stays rejected in the thread and nothing was executed. There is no retry limit:
 * every retry is a new approval.
 */
test("a rejected tool the model asks for again pauses the same run again; nothing is executed", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigParallelTools, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const refundCall = (callId: string): Parameters<FakeLLMClient["enqueueRunStep"]>[0] => ({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId,
      toolName: refundTool.name,
      input: {amount: 500},
    },
  });
  llmClient.enqueueRunStep(refundCall("call-1"));
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5375185962829,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  llmClient.enqueueRunStep(refundCall("call-2"));
  const pausedAgain = await gateway.resume({
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
  expect([
    pausedAgain.kind,
    pausedAgain.kind === EGatewayResponseKind.PAUSED && [
      pausedAgain.envelopes[0].runId === paused.envelopes[0].runId,
      pausedAgain.envelopes[0].kind === EPauseKind.TOOL_APPROVAL && pausedAgain.envelopes[0].toolCall.callId,
    ],
    toolResults.map(part => [part.callId, part.rejected ?? false]),
  ]).toEqual([
    EGatewayResponseKind.PAUSED,
    [true, "call-2"],
    [["call-1", true]],
  ]);
});
