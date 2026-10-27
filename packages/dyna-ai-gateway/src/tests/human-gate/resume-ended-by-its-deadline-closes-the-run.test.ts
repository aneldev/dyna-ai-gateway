import {dynaError} from "dyna-error";

import {
  AIGateway,
  CALL_TIMED_OUT_ISSUE_CODE,
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
import {makeTimeoutError} from "../internal/utils/makeTimeoutError";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  abortedResume,
  gatewayConfigAbortedResume,
  slowRefundTool,
} from "./aborted-resume.config";

/**
 * `timeoutMs` on a resume caps the approved tool too: past the deadline the resume is FAILED naming it (the issue
 * `call_timed_out`), and the run is closed: status FAILED, the cut tool call answered with an error result naming the deadline,
 * the thread open again. The deadline is the tool's doing, not a clock's: `AbortSignal.timeout` is stood in for by a controller
 * the tool fires as it starts.
 */
test("a resume that passes its timeoutMs inside the approved tool is FAILED and closes the run", async () => {
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
      code: 5376412760089,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const deadline = new AbortController();
  const timeoutSpy = jest.spyOn(AbortSignal, "timeout");

  let resumed: TGatewayResponse;
  try {
    timeoutSpy.mockReturnValue(deadline.signal);
    abortedResume.controller = deadline;
    abortedResume.reason = makeTimeoutError();
    resumed = await gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
      timeoutMs: 1_000,
    }).response;
  }
  finally {
    abortedResume.controller = undefined;
    abortedResume.reason = undefined;
    timeoutSpy.mockRestore();
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
      reason: "The call timed out after 1000 ms",
      issues: [
        {
          code: CALL_TIMED_OUT_ISSUE_CODE,
          message: "The call timed out after 1000 ms",
          severity: EIssueSeverity.ERROR,
        },
      ],
    },
    ERunStatus.FAILED,
    EThreadStatus.OPEN,
    [["call-1", {error: "The call timed out after 1000 ms"}, true]],
  ]);
});
