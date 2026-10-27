import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
  EThreadStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {
  RUN_STORE_FAILURE_CODE,
  runStoreFailure,
} from "../internal/utils/FailingRunRepository";
import {threadStoreFailure} from "../internal/utils/FailingThreadRepository";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {anthropicRefundProfile} from "./resume-on-another-profile.config";
import {gatewayConfigUnrecoverableClose} from "./unrecoverable-close.config";

/**
 * The resume breaks on the profile switch and the thread store breaks as the run is closed: the resume rejects with the first
 * error (the cause, not the closing's), the run is still marked FAILED so it is terminal and visible, and the thread stays
 * waiting for the human with its tool call unanswered, logged for an operator (`5376412760091`).
 */
test("a resume whose closing fails rejects with the cause, marks the run FAILED and leaves the thread for an operator", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigUnrecoverableClose, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: "refund",
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
      code: 5376412760098,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  runStoreFailure.armed = true;
  threadStoreFailure.armed = true;

  let rejection: unknown;
  let logged: string[];
  try {
    await gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
      profileId: anthropicRefundProfile.id,
    }).response;
  }
  catch (error) {
    rejection = error;
  }
  finally {
    runStoreFailure.armed = false;
    threadStoreFailure.armed = false;
    // Read before the restore: it clears the recorded calls
    logged = consoleError.mock.calls.map(([message]) => String(message).slice(0, 28));
    consoleError.mockRestore();
  }

  const run = await gatewayConfigUnrecoverableClose.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigUnrecoverableClose.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: paused.threadId,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigUnrecoverableClose,
    threadId: paused.threadId,
  });
  expect([
    rejection,
    logged,
    run?.status,
    thread?.status,
    toolResults,
  ]).toEqual([
    expect.objectContaining({code: RUN_STORE_FAILURE_CODE}),
    ["Internal error 5376412760091"],
    ERunStatus.FAILED,
    EThreadStatus.AWAITING_HUMAN,
    [],
  ]);
});
