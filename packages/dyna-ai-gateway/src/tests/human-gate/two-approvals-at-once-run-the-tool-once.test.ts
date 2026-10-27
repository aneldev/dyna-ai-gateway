import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  countedRefundTool,
  gatewayConfigConcurrentResume,
  refundExecutions,
} from "./concurrent-resume.config";

/**
 * Two approvals of the same pause arrive together (a double click, two tabs). Two guards stand in the way, each a 409: the
 * thread's lease (D77) lets one call on the thread at a time, and the run leaves PAUSED in one atomic step (D69) for the case
 * the lease has expired. One approval continues the run, the other is refused by the first guard it meets; the refund runs once.
 */
test("two approvals at once: one resumes the run, the other is refused, the tool runs once", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigConcurrentResume, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: countedRefundTool.name,
      input: {amount: 500},
    },
  });
  llmClient.enqueueRunStep({text: "Refunded."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 to the customer",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5375172583935,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const approve = (): Promise<unknown> => gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;

  const outcomes = await Promise.allSettled([approve(), approve()]);

  const kinds = outcomes.map(outcome => outcome.status === "fulfilled"
    ? (outcome.value as {kind: string}).kind
    : (outcome.reason as {code: number; status: number}));
  expect([kinds.sort(), refundExecutions.count]).toEqual([
    [
      EGatewayResponseKind.ANSWER,
      expect.objectContaining({status: 409}),
    ].sort(),
    1,
  ]);
});
