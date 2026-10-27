import {dynaError} from "dyna-error";

import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  EIssueSeverity,
  EPartKind,
  EResumeAction,
  ERunStatus,
  EThreadStatus,
  TGatewayResponse,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  abortedResume,
  gatewayConfigAbortedResume,
  slowRefundTool,
} from "./aborted-resume.config";

/**
 * The caller aborts a resume while the approved tool runs (the tool presses "stop" as it starts): the response is FAILED with the
 * reason, and the run is closed: status FAILED, the cut tool call answered with an error result in the thread, the thread open again.
 */
test("a resume aborted during the approved tool is FAILED; the run is FAILED, its tool call closed, the thread open", async () => {
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
      code: 5376325411025,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const controller = new AbortController();
  abortedResume.controller = controller;

  let resumed: TGatewayResponse;
  try {
    resumed = await gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
      abortSignal: controller.signal,
    }).response;
  }
  finally {
    abortedResume.controller = undefined;
  }

  const run = await gatewayConfigAbortedResume.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigAbortedResume.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: paused.threadId,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigAbortedResume,
    threadId: paused.threadId,
  });
  expect([
    resumed,
    run?.status,
    thread?.status,
    toolResults.map(part => [part.callId, part.output, part.failed]),
  ]).toEqual([
    {
      kind: EGatewayResponseKind.FAILED,
      threadId: paused.threadId,
      reason: "The call was aborted",
      issues: [
        {
          code: CALL_ABORTED_ISSUE_CODE,
          message: "The call was aborted",
          severity: EIssueSeverity.ERROR,
        },
      ],
    },
    ERunStatus.FAILED,
    EThreadStatus.OPEN,
    [["call-1", {error: "The call was aborted"}, true]],
  ]);
});
