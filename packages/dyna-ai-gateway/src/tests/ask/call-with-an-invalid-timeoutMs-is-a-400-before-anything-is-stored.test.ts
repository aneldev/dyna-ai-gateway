import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigInvalidTimeout} from "./invalid-timeout.config";

/** A `timeoutMs` of 0 is a developer error: the call rejects with a 400 before a thread exists and before the model is called. */
test("an ask with timeoutMs 0 rejects with a 400 and stores nothing", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigInvalidTimeout, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  await expect(gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
    timeoutMs: 0,
  }).response).rejects.toMatchObject({
    status: 400,
    code: 5376312450001,
  });

  const {items: threads} = await gatewayConfigInvalidTimeout.threadStore.repository.listThreads({
    tenantId: sampleUserContext.tenantId,
    userId: sampleUserContext.userId,
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: null,
    },
  });
  expect(threads.length).toBe(0);
});
