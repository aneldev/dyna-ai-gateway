import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  anthropicRefundProfile,
  gatewayConfigResumeOnAnotherProfile,
  openAiRefundProfile,
} from "./resume-on-another-profile.config";

/**
 * A run paused on OpenAI resumes on the Anthropic profile (D65): the continuation is traced on the new model and the run is
 * stored with the new profile. The model is swapped live, with no restart and no new thread.
 */
test("a paused run resumed with another profile continues on that profile's model", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigResumeOnAnotherProfile, {llmClient: () => llmClient});
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
  llmClient.enqueueRunStep({text: "Refunded."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 to the customer",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5374489246363,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
    profileId: anthropicRefundProfile.id,
  }).response;

  const steps = await gateway.trace.query({
    tenantId: sampleUserContext.tenantId,
    filters: {kind: ETraceKind.RUN_STEP},
    skip: 0,
    limit: 10,
  });
  const run = await gatewayConfigResumeOnAnotherProfile.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });
  expect([
    response.kind,
    steps.map(step => step.modelId).sort(),
    run?.profileId,
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [anthropicRefundProfile.modelId, openAiRefundProfile.modelId].sort(),
    anthropicRefundProfile.id,
  ]);
});
