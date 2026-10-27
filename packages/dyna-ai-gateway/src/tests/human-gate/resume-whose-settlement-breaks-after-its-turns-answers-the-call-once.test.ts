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

import {quickRefundTool} from "./aborted-resume-after-the-tool.config";
import {gatewayConfigBrokenSettlement} from "./broken-settlement.config";

/**
 * The approved tool ran and the run finished, its turns are stored, and the run store fails as the run is marked DONE: the
 * resume rejects with the store's error, the run is closed FAILED with the thread open again, and the tool call keeps its one
 * real result: closing reads the thread, so an answered call is not answered again.
 */
test("a resume whose settlement breaks after its turns are stored is closed with the tool call answered once", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigBrokenSettlement, {llmClient: () => llmClient});
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
  llmClient.enqueueRunStep({text: "Refunded."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 to the customer",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5376412760094,
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
    }).response;
  }
  catch (error) {
    rejection = error;
  }
  finally {
    runStoreFailure.armed = false;
  }

  const run = await gatewayConfigBrokenSettlement.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const thread = await gatewayConfigBrokenSettlement.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: paused.threadId,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigBrokenSettlement,
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
    [["call-1", {refunded: 500}, undefined]],
  ]);
});
