import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  IUserContext,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigThreadOfAnotherUser} from "./thread-of-another-user.config";

/**
 * A thread belongs to its user (D32): `ask` and `run` of another user of the tenant on it are the 404 of an unknown thread,
 * checked before the lease, so a busy thread is not a 409 that tells the other user it exists. Nothing is stored on it.
 */
test("ask and run on a thread of another user of the tenant are a 404, before the lease, and store nothing", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigThreadOfAnotherUser, {llmClient: () => llmClient});
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello A.",
  }));
  const own = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
  }).response;
  if (own.kind !== EGatewayResponseKind.ANSWER) {
    throw dynaError({
      code: 5377210486113,
      message: `Test setup: expected ANSWER, got ${own.kind}`,
      data: {own},
    });
  }
  const {threadStore} = gatewayConfigThreadOfAnotherUser;
  const {tenantId} = sampleUserContext;
  // The owner's call holds the lease: a check after the lease would answer 409
  const now = new Date();
  await threadStore.repository.acquireLease({
    tenantId,
    threadId: own.threadId,
    token: "owner-call",
    expiresAt: new Date(now.getTime() + 60_000),
    now,
  });
  const otherUser: IUserContext = {
    ...sampleUserContext,
    userId: "another-user",
  };

  const outcomes = await Promise.allSettled([
    gateway.ask({
      profileId: "default",
      userContext: otherUser,
      threadId: own.threadId,
      prompt: "What did they ask?",
      kbFilters: noKb,
    }).response,
    gateway.run({
      profileId: "default",
      userContext: otherUser,
      threadId: own.threadId,
      prompt: "What did they ask?",
      kbFilters: noKb,
    }).response,
  ]);

  const turns = await threadStore.repository.loadTurns({
    tenantId,
    threadId: own.threadId,
    desc: false,
    skip: 0,
    limit: 20,
  });
  const notFound = {
    status: "rejected",
    reason: expect.objectContaining({
      code: 5372799784161,
      status: 404,
    }),
  };
  expect([outcomes, turns.length]).toEqual([[notFound, notFound], 2]);
});
