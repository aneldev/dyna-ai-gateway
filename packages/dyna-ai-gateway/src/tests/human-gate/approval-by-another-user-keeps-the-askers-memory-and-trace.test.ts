import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ETraceKind,
  EUserMemoryFactOp,
  IUserContext,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {refundOnApprovalTool} from "./paused-run-with-a-file.config";
import {gatewayConfigResumeByAnotherUser} from "./resume-by-another-user.config";

/**
 * The run is the asker's, also when another user of the tenant approves it (D32): the facts extracted after the resumed answer
 * are the asker's, the resumed step is traced under the asker, the approver's memory stays empty, and erasing the asker
 * leaves nothing of the run's trace behind.
 */
test("an approval by another user stores the facts and the trace of the resumed step under the asker", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigResumeByAnotherUser, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const {tenantId} = sampleUserContext;
  const approver: IUserContext = {
    ...sampleUserContext,
    userId: "approver",
  };
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: refundOnApprovalTool.name,
      input: {amount: 20},
    },
  });
  llmClient.enqueueRunStep({text: "Refunded 20 EUR."});
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    structured: {
      facts: [{
        key: "city",
        value: "Vienna",
        op: EUserMemoryFactOp.SET,
      }],
    },
  }), ETraceKind.MEMORY_USER);
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "I live in Vienna, refund my 20 EUR",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5377210486187,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  await gateway.resume({
    userContext: approver,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;
  await gateway.whenIdle();

  const askerFacts = await gateway.getUserFacts({userContext: sampleUserContext});
  const approverFacts = await gateway.getUserFacts({userContext: approver});
  const approverEntries = await gateway.trace.query({
    tenantId,
    filters: {userId: approver.userId},
    skip: 0,
    limit: 100,
  });
  await gateway.deleteUserData({
    tenantId,
    userId: sampleUserContext.userId,
  });
  const leftOfTheRun = await gateway.trace.query({
    tenantId,
    filters: {threadId: paused.threadId},
    skip: 0,
    limit: 100,
  });
  expect([askerFacts.map(fact => fact.value), approverFacts, approverEntries, leftOfTheRun.filter(entry => entry.userId === sampleUserContext.userId)]).toEqual([
    ["Vienna"],
    [],
    [],
    [],
  ]);
});
