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
 * While a user's data is being erased, a new call of that user would write it again: it is a 409 and stores nothing.
 * The erasure here waits for a call that was already running, which keeps it open long enough to try.
 */
test("ask by a user whose erasure is running is a 409", async () => {
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
  // The memory job of the running call finds nothing to remember
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    structured: {facts: []},
  }), ETraceKind.MEMORY_USER);
  const running = gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
  }).response;
  await started;
  const erasure = gateway.deleteUserData({
    tenantId,
    userId,
  });

  const refused = gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Remember me",
    kbFilters: noKb,
  }).response;

  await expect(refused).rejects.toMatchObject({
    code: 5377210486211,
    status: 409,
  });
  await Promise.all([running, erasure]);
  await gateway.whenIdle();
});
