import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigThreadLease} from "./thread-lease.config";

/**
 * Two calls on one thread at once (a double click, two tabs): the thread's lease (D77) lets one through and refuses the other
 * with a 409 before it stores anything; one user turn and one answer are stored. The lease is released with the call, so a
 * later call on the thread goes through.
 */
test("two asks on one thread at once: one answers, the other is a 409, a later ask goes through", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigThreadLease, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const answer = (text: string): void => {
    llmClient.enqueueComplete(makeModelResult({
      modelId: openAiModel.id,
      text,
    }));
  };
  answer("First.");
  const first = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
  }).response;
  if (first.kind !== EGatewayResponseKind.ANSWER) {
    throw dynaError({
      code: 5375384011287,
      message: `Test setup: expected ANSWER, got ${first.kind}`,
      data: {first},
    });
  }
  const ask = (text: string): Promise<unknown> => {
    answer(text);
    return gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      threadId: first.threadId,
      prompt: text,
      kbFilters: noKb,
    }).response;
  };

  const outcomes = await Promise.allSettled([ask("Second"), ask("Third")]);
  const later = await ask("Fourth");

  const kinds = outcomes.map(outcome => outcome.status === "fulfilled"
    ? (outcome.value as {kind: string}).kind
    : (outcome.reason as {code: number; status: number}));
  const turns = await gatewayConfigThreadLease.threadStore.repository.loadTurns({
    tenantId: sampleUserContext.tenantId,
    threadId: first.threadId,
    desc: false,
    skip: 0,
    limit: 20,
  });
  expect([kinds.sort(), (later as {kind: string}).kind, turns.length]).toEqual([
    [
      EGatewayResponseKind.ANSWER,
      expect.objectContaining({
        code: 5375384011263,
        status: 409,
      }),
    ].sort(),
    EGatewayResponseKind.ANSWER,
    6,
  ]);
});
