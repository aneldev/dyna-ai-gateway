import {
  AIGateway,
  EGatewayResponseKind,
  EIssueSeverity,
  EPartKind,
  ETraceKind,
  USAGE_DENIED_ISSUE_CODE,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {getCurrentTimeTool} from "../internal/samples/tools";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  denial,
  gatewayConfigDenySecondRunStep,
  usageAdapterDenyingSecondRunStep,
} from "./denied.config";

/**
 * The first step called a tool; the app says no to the second. The tool has had its effect, so the run is not thrown away: it
 * ends DONE with the text so far, as a run stopped by its step limit does (the WARNING `output_truncated`), plus the WARNING
 * `usage_denied` with the app's code and user message. The tool result is on the thread; only the approved step was reported.
 */
test("a later run step the app refuses ends the run with the text so far and the warning usage_denied", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDenySecondRunStep, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    text: "Let me check the clock.",
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: getCurrentTimeTool.name,
      input: {},
    },
  });

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What time is it?",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigDenySecondRunStep,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.ANSWER && response.text,
    response.kind === EGatewayResponseKind.ANSWER && response.issues.map(issue => [issue.code, issue.severity, issue.userMessage, issue.data]),
    toolResults.map(part => [part.callId, part.failed]),
    usageAdapterDenyingSecondRunStep.checkCalls.map(call => call.kind),
    usageAdapterDenyingSecondRunStep.addUsageCalls.map(call => call.kind),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    "Let me check the clock.",
    [
      [USAGE_DENIED_ISSUE_CODE, EIssueSeverity.WARNING, denial.denyUserMessage, {denyCode: denial.denyCode}],
      ["output_truncated", EIssueSeverity.WARNING, undefined, undefined],
    ],
    [["call-1", undefined]],
    [ETraceKind.RUN_STEP, ETraceKind.RUN_STEP],
    [ETraceKind.RUN_STEP],
  ]);
});
