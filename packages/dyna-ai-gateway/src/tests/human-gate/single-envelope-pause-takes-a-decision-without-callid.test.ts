import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  cancelOrderTool,
  gatewayConfigParallelApprovals,
} from "./parallel-approvals.config";

/**
 * The common case stays simple (D102): a pause of one envelope takes one decision without `callId`, on a parallel profile too.
 */
test("a pause of one envelope takes a decision without callId", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigParallelApprovals, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: cancelOrderTool.name,
      input: {orderId: "A-1"},
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Cancel order A-1",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5376681234551,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  llmClient.enqueueRunStep({text: "Cancelled."});
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;

  const results = await loadToolResults({
    config: gatewayConfigParallelApprovals,
    threadId: paused.threadId,
  });
  expect([
    paused.envelopes.length,
    response.kind,
    results.map(part => [part.callId, part.output]),
  ]).toEqual([
    1,
    EGatewayResponseKind.ANSWER,
    [["call-1", {cancelled: "A-1"}]],
  ]);
});
