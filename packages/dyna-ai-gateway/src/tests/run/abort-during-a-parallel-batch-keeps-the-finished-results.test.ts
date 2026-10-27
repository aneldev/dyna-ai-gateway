import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  abortController,
  gatewayConfigAbortInABatch,
  hangUntilStoppedTool,
  logEventTool,
} from "./abort-in-a-batch.config";

/**
 * One step asks for a quick tool and a hanging one; on a parallel profile (D101) they run together. The caller presses "stop"
 * after the quick one finished, while the other hangs. The call is FAILED as aborted (D90), and the thread holds the quick
 * tool's real result followed by the cut call's error result: nothing that finished is lost, no call is left unanswered.
 */
test("an abort during a parallel batch keeps the finished results and closes the cut call", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAbortInABatch, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCalls: [
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-1",
        toolName: logEventTool.name,
        input: {name: "signup"},
      },
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-2",
        toolName: hangUntilStoppedTool.name,
        input: {},
      },
    ],
  });

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Log the signup and wait",
    kbFilters: noKb,
    abortSignal: abortController.signal,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigAbortInABatch,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => issue.code),
    toolResults.map(part => [part.callId, part.failed ?? false, part.output]),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [CALL_ABORTED_ISSUE_CODE],
    [
      ["call-1", false, {logged: true}],
      ["call-2", true, {error: "The call was aborted"}],
    ],
  ]);
});
