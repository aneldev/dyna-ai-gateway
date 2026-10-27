import {
  AIGateway,
  EGatewayResponseKind,
  ETraceKind,
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
 * A call of the user that is running when the erasure starts would write after it: its turns, its trace entry. The
 * erasure waits for the call to end, then deletes: nothing of the user is left, and the call itself still answers.
 */
test("deleteUserData waits for the user's running call, then leaves no thread and no trace entry of the user", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigErasure, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const {
    tenantId, userId,
  } = sampleUserContext;
  let modelStarted = (): void => undefined;
  const started = new Promise<void>(resolve => {
    modelStarted = resolve;
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello.",
  }), ETraceKind.CHAT, {
    delayMs: 200,
    onCalled: () => modelStarted(),
  });
  // The memory job of the answer finds nothing to remember
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    structured: {facts: []},
  }), ETraceKind.MEMORY_USER);

  const call = gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
  }).response;
  await started;
  await gateway.deleteUserData({
    tenantId,
    userId,
  });
  const answer = await call;

  const {items: threads} = await gatewayConfigErasure.threadStore.repository.listThreads({
    tenantId,
    userId,
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: null,
    },
  });
  const entries = await gateway.trace.query({
    tenantId,
    filters: {userId},
    skip: 0,
    limit: 10,
  });
  expect([answer.kind, threads, entries]).toEqual([EGatewayResponseKind.ANSWER, [], []]);
});
