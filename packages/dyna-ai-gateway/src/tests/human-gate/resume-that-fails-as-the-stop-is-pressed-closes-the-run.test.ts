import {dynaError} from "dyna-error";

import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
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

import {slowRefundTool} from "./aborted-resume.config";
import {
  gatewayConfigAbortedResumeStoreFailure,
  storeFailure,
} from "./aborted-resume-store-failure.config";

/**
 * A store fails after the run left PAUSED and before the model is called, as the caller presses "stop": the resume is answered as
 * the abort (the foreign error is logged), and the run is closed, not left RUNNING: status FAILED, its pending tool call answered
 * with the abort as its error result, the thread open again.
 */
test("a resume that fails in a store as the stop is pressed is FAILED and closes the run", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAbortedResumeStoreFailure, {llmClient: () => llmClient});
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
      code: 5376412760088,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const controller = new AbortController();
  storeFailure.controller = controller;
  storeFailure.runId = paused.envelopes[0].runId;
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

  let resumed: TGatewayResponse;
  let logged: string[];
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
    storeFailure.controller = undefined;
    storeFailure.runId = undefined;
    // Read before the restore: it clears the recorded calls
    logged = consoleError.mock.calls.map(([message]) => String(message).slice(0, 28));
    consoleError.mockRestore();
  }

  const run = await gatewayConfigAbortedResumeStoreFailure.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigAbortedResumeStoreFailure.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: paused.threadId,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigAbortedResumeStoreFailure,
    threadId: paused.threadId,
  });
  expect([
    resumed.kind,
    resumed.kind === EGatewayResponseKind.FAILED && resumed.issues.map(issue => issue.code),
    logged,
    run?.status,
    thread?.status,
    toolResults.map(part => [part.callId, part.output, part.failed]),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [CALL_ABORTED_ISSUE_CODE],
    ["Internal error 5376412760013"],
    ERunStatus.FAILED,
    EThreadStatus.OPEN,
    [["call-1", {error: "The call was aborted"}, true]],
  ]);
});
