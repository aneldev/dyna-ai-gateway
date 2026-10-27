import {
  AIGateway,
  CALL_TIMED_OUT_ISSUE_CODE,
  EGatewayResponseKind,
  EIssueSeverity,
  EPartKind,
  ERunStatus,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigHangingTool,
  hangingToolCalls,
  waitForeverTool,
} from "./hanging-tool.config";

/**
 * `timeoutMs` caps the whole run, tools included: past the deadline the call returns FAILED naming it (the issue `call_timed_out`),
 * not after the tool's own 30 s timeout; the tool's signal is aborted so it can stop. The user turn and the model's tool request
 * are stored, the cut tool call gets an error result naming the deadline, and no run record exists: the run never paused.
 * The deadline is the tool's doing, not a clock's: `AbortSignal.timeout` is stood in for by a controller the tool fires as it starts.
 */
test("a run that passes its timeoutMs inside a tool is FAILED, the tool is told, the cut call gets an error result", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigHangingTool, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: waitForeverTool.name,
      input: {},
    },
  });
  const deadline = new AbortController();
  const timeoutSpy = jest.spyOn(AbortSignal, "timeout");

  let response;
  let deadlinesAsked: unknown[][];
  try {
    timeoutSpy.mockReturnValue(deadline.signal);
    hangingToolCalls.deadline = deadline;
    response = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Wait for the external system",
      kbFilters: noKb,
      timeoutMs: 1_000,
    }).response;
  }
  finally {
    hangingToolCalls.deadline = undefined;
    // Read before the restore: it clears the recorded calls
    deadlinesAsked = timeoutSpy.mock.calls;
    timeoutSpy.mockRestore();
  }

  const turns = await gatewayConfigHangingTool.threadStore.repository.loadTurns({
    tenantId: sampleUserContext.tenantId,
    threadId: response.threadId ?? "",
    desc: false,
    skip: 0,
    limit: 20,
  });
  const runs = (await Promise.all(Object.values(ERunStatus).map(status => gatewayConfigHangingTool.runStore.repository.listByStatus({
    tenantId: sampleUserContext.tenantId,
    status,
  })))).flat();
  const toolResults = await loadToolResults({
    config: gatewayConfigHangingTool,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.reason,
    response.kind === EGatewayResponseKind.FAILED && response.issues,
    deadlinesAsked,
    hangingToolCalls.signals.splice(0).map(signal => signal.aborted),
    turns.map(turn => turn.role),
    toolResults.map(part => [part.callId, part.output, part.failed]),
    runs.length,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    "The call timed out after 1000 ms",
    [
      {
        code: CALL_TIMED_OUT_ISSUE_CODE,
        message: "The call timed out after 1000 ms",
        severity: EIssueSeverity.ERROR,
      },
    ],
    [[1_000]],
    [true],
    [ETurnRole.USER, ETurnRole.ASSISTANT, ETurnRole.TOOL],
    [["call-1", {error: "The call timed out after 1000 ms"}, true]],
    0,
  ]);
});
