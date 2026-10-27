import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSharedRepositories} from "./shared-repositories.config";

/**
 * Live adjustment through dependency injection: a run pauses on one gateway; a second gateway, built on the same config with
 * another LLM client injected, resumes it. The state lives in the repositories of the config, not in the gateway instance,
 * so the swap is a new gateway and nothing else; the continuation runs on the injected client only.
 */
test("a second gateway with another LLM client injected resumes a run paused on the first", async () => {
  const firstClient = new FakeLLMClient();
  const first = new AIGateway(gatewayConfigSharedRepositories, {llmClient: () => firstClient});
  firstClient.accountTo({
    trace: first.trace,
    usageGuard: first.usageGuard,
  });
  firstClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: refundTool.name,
      input: {amount: 500},
    },
  });
  const paused = await first.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5375207490003,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  const secondClient = new FakeLLMClient();
  const second = new AIGateway(gatewayConfigSharedRepositories, {llmClient: () => secondClient});
  secondClient.accountTo({
    trace: second.trace,
    usageGuard: second.usageGuard,
  });
  secondClient.enqueueRunStep({text: "Refunded."});
  const response = await second.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;

  const run = await gatewayConfigSharedRepositories.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.ANSWER && response.text,
    [firstClient.runCalls.length, secondClient.runCalls.length],
    run?.status,
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    "Refunded.",
    [1, 1],
    ERunStatus.DONE,
  ]);
});
