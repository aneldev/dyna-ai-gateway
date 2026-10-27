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

import {lookupOrderTool} from "./parallel-tools.config";
import {gatewayConfigSequentialTools} from "./sequential-tools.config";

/**
 * On a profile with `parallelToolCalls: false` the calls of a step run one after the other (D101): a refund that needs
 * approval pauses the run before the read-only lookup behind it is even decided, so nothing is stored at the pause. After
 * APPROVE the refund runs, then the lookup, and the thread holds both results in request order.
 */
test("a sequential profile pauses before the calls behind the one that needs approval; they run on resume, in order", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSequentialTools, {llmClient: () => llmClient});
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
      code: 5376561294731,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const resultsWhilePaused = await loadToolResults({
    config: gatewayConfigSequentialTools,
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
    config: gatewayConfigSequentialTools,
    threadId: paused.threadId,
  });
  expect([resultsWhilePaused, response.kind, resultsAfter.map(part => part.callId)]).toEqual([
    [],
    EGatewayResponseKind.ANSWER,
    ["call-1", "call-2"],
  ]);
});
