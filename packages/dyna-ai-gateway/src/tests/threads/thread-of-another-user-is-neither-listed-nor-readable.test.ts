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

import {gatewayConfigThreads} from "./threads.config";

/**
 * A thread belongs to its user (D32): another user of the tenant does not see it in `listThreads`, cannot use it as a cursor,
 * and gets the 404 of an unknown thread from `getTurns` and `renameThread` — nothing tells them it exists. The owner's title stays.
 */
test("another user of the tenant does not list, read, rename or page from the thread", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigThreads, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
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
      code: 5379462948315,
      message: `Test setup: expected ANSWER, got ${own.kind}`,
      data: {own},
    });
  }
  const otherUser: IUserContext = {
    ...sampleUserContext,
    userId: "another-user",
  };

  const listed = await gateway.listThreads({
    userContext: otherUser,
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: null,
    },
  });
  const outcomes = await Promise.allSettled([
    gateway.getTurns({
      userContext: otherUser,
      threadId: own.threadId,
    }),
    gateway.renameThread({
      userContext: otherUser,
      threadId: own.threadId,
      title: "Taken over",
    }),
    gateway.listThreads({
      userContext: otherUser,
      page: {
        limit: 10,
        startingAfter: null,
        endingBefore: own.threadId,
      },
    }),
  ]);
  const ownTitle = (await gateway.listThreads({
    userContext: sampleUserContext,
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: null,
    },
  })).items.find(thread => thread.id === own.threadId)?.title;

  const notFound = (code: number): unknown => ({
    status: "rejected",
    reason: expect.objectContaining({
      code,
      status: 404,
    }),
  });
  expect([listed.items, outcomes, ownTitle]).toEqual([
    [],
    [notFound(5372799784161), notFound(5372799784161), notFound(5379462948293)],
    "",
  ]);
});
