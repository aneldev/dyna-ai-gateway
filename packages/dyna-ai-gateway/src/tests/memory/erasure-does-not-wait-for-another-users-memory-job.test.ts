import {
  AIGateway,
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

import {gatewayConfigErasure} from "./erasure.config";

/**
 * The erasure of one user waits for that user's background work only. A slow memory job of another user — on a busy server
 * there always is one — does not hold it up: the erasure returns while the other job is still running.
 */
test("deleteUserData returns while another user's memory job is still running", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigErasure, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const otherUser: IUserContext = {
    ...sampleUserContext,
    userId: "another-user",
  };
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello.",
  }));
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    structured: {
      facts: [{
        key: "city",
        value: "Vienna",
        op: EUserMemoryFactOp.SET,
      }],
    },
  }), ETraceKind.MEMORY_USER, {delayMs: 1_000});
  await gateway.ask({
    profileId: "default",
    userContext: otherUser,
    prompt: "I live in Vienna",
    kbFilters: noKb,
  }).response;

  await gateway.deleteUserData({
    tenantId: sampleUserContext.tenantId,
    userId: sampleUserContext.userId,
  });
  const otherFactsDuringTheJob = await gateway.getUserFacts({userContext: otherUser});
  await gateway.whenIdle();
  const otherFactsAfterTheJob = await gateway.getUserFacts({userContext: otherUser});

  expect([otherFactsDuringTheJob, otherFactsAfterTheJob.map(fact => fact.value)]).toEqual([[], ["Vienna"]]);
});
