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
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigFailingRunSave} from "./failing-run-save.config";
import {anthropicRefundProfile} from "./resume-on-another-profile.config";

/**
 * The run store fails while the resume stores the profile switch (D65), right after the run left PAUSED: the resume rejects
 * with the store's error and the run is closed, not left RUNNING: status FAILED, its pending tool call answered with an error
 * result, the thread open again.
 */
test("a resume whose save fails on the profile switch rejects and closes the run", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigFailingRunSave, {llmClient: () => llmClient});
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
      code: 5376412760093,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  runStoreFailure.armed = true;

  let rejection: unknown;
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
  }

  const run = await gatewayConfigFailingRunSave.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigFailingRunSave.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: paused.threadId,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigFailingRunSave,
    threadId: paused.threadId,
  });
  expect([
    rejection,
    run?.status,
    thread?.status,
    toolResults.map(part => [part.callId, part.output, part.failed]),
  ]).toEqual([
    expect.objectContaining({code: RUN_STORE_FAILURE_CODE}),
    ERunStatus.FAILED,
    EThreadStatus.OPEN,
    [["call-1", {error: "The run failed before it completed"}, true]],
  ]);
});
