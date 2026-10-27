import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
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

import {gatewayConfigResumeByAnotherUser} from "./resume-by-another-user.config";

/**
 * A reviewer is by design another person than the asker (D99). The facts extracted after the approved answer are the
 * asker's: a moderator who reviews many customers' answers does not collect their facts in their own memory.
 */
test("a review approved by another user extracts the facts into the asker's memory, not the reviewer's", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigResumeByAnotherUser, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const reviewer: IUserContext = {
    ...sampleUserContext,
    userId: "reviewer",
  };
  llmClient.enqueueRunStep({text: "Your order goes to Vienna."});
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
    profileId: "reviewed",
    userContext: sampleUserContext,
    prompt: "I live in Vienna, where does my order go?",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5377210486191,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  await gateway.resume({
    userContext: reviewer,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;
  await gateway.whenIdle();

  const askerFacts = await gateway.getUserFacts({userContext: sampleUserContext});
  const reviewerFacts = await gateway.getUserFacts({userContext: reviewer});
  expect([askerFacts.map(fact => fact.value), reviewerFacts]).toEqual([["Vienna"], []]);
});
