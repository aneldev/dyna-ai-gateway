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
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigAbortedResumeAfterTheTool,
  quickRefundTool,
} from "./aborted-resume-after-the-tool.config";

/**
 * The human approved; the refund ran; the caller presses "stop" the moment the next model call starts (it would take 10 s). The
 * resume is FAILED, the run is closed FAILED and the thread is open again, and the refund stays on record with its real result:
 * the thread never says the refund failed.
 */
test("a resume aborted after the approved tool ran is FAILED and keeps the tool's real result", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAbortedResumeAfterTheTool, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: quickRefundTool.name,
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
      code: 5376412760087,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const controller = new AbortController();
  llmClient.enqueueRunStep({
    text: "Refunded.",
    delayMs: 10_000,
    onCalled: (): void => controller.abort(),
  });

  const resumed = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
    abortSignal: controller.signal,
  }).response;

  const run = await gatewayConfigAbortedResumeAfterTheTool.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigAbortedResumeAfterTheTool.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: paused.threadId,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigAbortedResumeAfterTheTool,
    threadId: paused.threadId,
  });
  expect([
    resumed.kind,
    resumed.kind === EGatewayResponseKind.FAILED && resumed.issues.map(issue => issue.code),
    run?.status,
    thread?.status,
    toolResults.map(part => [part.callId, part.output, part.failed]),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [CALL_ABORTED_ISSUE_CODE],
    ERunStatus.FAILED,
    EThreadStatus.OPEN,
    [["call-1", {refunded: 500}, undefined]],
  ]);
});
