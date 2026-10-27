import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  EPauseKind,
  EResumeAction,
  ETraceKind,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  anthropicRefundProfile,
  gatewayConfigResumeOnAnotherProfile,
  openAiRefundProfile,
} from "./resume-on-another-profile.config";

/**
 * The live model swap on real providers (D65): a run paused on OpenAI with the refund call pending resumes on the Anthropic
 * profile. The history of the first step (a reasoning model's tool call and its result) is mapped to the second provider;
 * the trace shows one step per model, the tool ran once with the approved input, the run is stored with the new profile.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY and AIGATEWAY_TEST_ANTHROPIC_API_KEY are in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI, EModelProvider.ANTHROPIC)("AIGateway — resume on another profile, real providers", () => {
  test("a run paused on OpenAI resumes on the Anthropic profile and finishes on its model", async () => {
    const gateway = new AIGateway(gatewayConfigResumeOnAnotherProfile);

    const paused = await gateway.run({
      userContext: sampleUserContext,
      profileId: openAiRefundProfile.id,
      prompt: "Refund 500 EUR to the customer.",
      kbFilters: noKb,
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) {
      throw dynaError({
        code: 5375292040293,
        message: `Test setup: expected PAUSED, got ${paused.kind}`,
        data: {paused},
      });
    }
    if (paused.envelopes[0].kind !== EPauseKind.TOOL_APPROVAL) {
      throw dynaError({
        code: 5375292040294,
        message: `Test setup: expected a TOOL_APPROVAL pause, got ${paused.envelopes[0].kind}`,
        data: {envelope: paused.envelopes[0]},
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
    const toolResults = await loadToolResults({
      config: gatewayConfigResumeOnAnotherProfile,
      threadId: paused.threadId,
    });
    expect([
      response.kind,
      steps.map(step => step.modelId).sort(),
      run?.profileId,
      toolResults.map(part => part.output),
    ]).toEqual([
      EGatewayResponseKind.ANSWER,
      [anthropicRefundProfile.modelId, openAiRefundProfile.modelId].sort(),
      anthropicRefundProfile.id,
      [{refunded: 500}],
    ]);
  });
});
