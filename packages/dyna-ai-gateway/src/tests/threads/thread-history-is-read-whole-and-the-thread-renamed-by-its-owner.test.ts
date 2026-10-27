import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  ETurnRole,
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
 * A chat screen that opens a conversation reads it whole with `getTurns`, oldest first (D37): two questions are four turns,
 * user and assistant in turn. `renameThread` gives the thread the user's title, and the list shows it.
 */
test("getTurns returns the whole history oldest first and renameThread sets the title the list shows", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigThreads, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello, I am here.",
  }));
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Still here.",
  }));
  const first = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
  }).response;
  if (first.kind !== EGatewayResponseKind.ANSWER) {
    throw dynaError({
      code: 5379462948304,
      message: `Test setup: expected ANSWER, got ${first.kind}`,
      data: {first},
    });
  }
  await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    threadId: first.threadId,
    prompt: "Are you there?",
    kbFilters: noKb,
  }).response;

  const turns = await gateway.getTurns({
    userContext: sampleUserContext,
    threadId: first.threadId,
  });
  await gateway.renameThread({
    userContext: sampleUserContext,
    threadId: first.threadId,
    title: "Saying hello",
  });
  const {items} = await gateway.listThreads({
    userContext: sampleUserContext,
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: null,
    },
  });

  expect([
    turns.map(turn => turn.role),
    items.find(thread => thread.id === first.threadId)?.title,
  ]).toEqual([
    [ETurnRole.USER, ETurnRole.ASSISTANT, ETurnRole.USER, ETurnRole.ASSISTANT],
    "Saying hello",
  ]);
});
