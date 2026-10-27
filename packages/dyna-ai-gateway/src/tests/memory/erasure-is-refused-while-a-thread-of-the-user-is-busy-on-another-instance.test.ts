import {
  AIGateway,
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
 * A live lease on a thread of the user is a call running on another instance of the gateway: this instance cannot wait for
 * it. The erasure is refused whole (409, the busy threads named) before anything is touched; once the lease is released the
 * same call erases. A partial erasure is never done: the host retries.
 */
test("deleteUserData is refused with the busy thread ids while a thread of the user holds a live lease, and erases once it is released", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigErasure, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const {
    tenantId, userId,
  } = sampleUserContext;
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello.",
  }), ETraceKind.CHAT);
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    structured: {facts: []},
  }), ETraceKind.MEMORY_USER);
  const answer = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
  }).response;
  await gateway.whenIdle();
  const threadId = answer.threadId ?? "";
  const repository = gatewayConfigErasure.threadStore.repository;
  const lease = {
    tenantId,
    threadId,
    token: "other-instance",
  };
  await repository.acquireLease({
    ...lease,
    expiresAt: new Date(Date.now() + 60_000),
    now: new Date(),
  });

  const refused = await gateway.deleteUserData({
    tenantId,
    userId,
  }).then(() => null, (error: unknown) => error as {status: number; data: {busyThreadIds: string[]}});
  const threadAfterRefusal = await repository.loadThread({
    tenantId,
    threadId,
  });
  await repository.releaseLease(lease);
  const erased = await gateway.deleteUserData({
    tenantId,
    userId,
  });
  const threadAfterErasure = await repository.loadThread({
    tenantId,
    threadId,
  });

  expect([
    refused?.status,
    refused?.data.busyThreadIds,
    threadAfterRefusal?.id,
    erased.threads,
    threadAfterErasure,
  ]).toEqual([409, [threadId], threadId, 1, null]);
});
