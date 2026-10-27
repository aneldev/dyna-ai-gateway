import {dynaError} from "dyna-error";

import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
  EThreadStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigAbortedResume,
  slowRefundTool,
} from "./aborted-resume.config";

/**
 * A resume whose signal is already aborted is answered FAILED, naming the run's thread, before the thread's lease is taken: the
 * run stays PAUSED and the thread keeps waiting for the human, so the decision can be sent again.
 */
test("a resume with an already-aborted signal is FAILED and leaves the run paused", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAbortedResume, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: slowRefundTool.name,
      input: {amount: 500},
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 to the customer",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5376412760075,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  const resumed = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
    abortSignal: AbortSignal.abort(),
  }).response;

  const run = await gatewayConfigAbortedResume.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigAbortedResume.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: paused.threadId,
  });
  expect([
    resumed.kind,
    resumed.threadId,
    resumed.kind === EGatewayResponseKind.FAILED && resumed.issues.map(issue => issue.code),
    run?.status,
    thread?.status,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    paused.threadId,
    [CALL_ABORTED_ISSUE_CODE],
    ERunStatus.PAUSED,
    EThreadStatus.AWAITING_HUMAN,
  ]);
});
