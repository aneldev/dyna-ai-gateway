import {
  AIGateway,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigUsage,
  usageAdapter,
} from "./usage.config";

/**
 * The app is asked before and told after every model call the gateway makes, not only the answer: with the thread memory on,
 * an ask makes a CHAT call and a MEMORY_WORKING helper call, and both reach the adapter with the user, the profile and their kind.
 */
test("the answer and the memory helper call of an ask are both checked and reported with their kind", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigUsage, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello.",
    usage: {
      inputTokens: 30,
      outputTokens: 5,
    },
  }));
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    structured: {
      summary: "Greeted.",
      facts: [],
    },
  }), ETraceKind.MEMORY_WORKING);

  await gateway.ask({
    profileId: sampleProfile.id,
    userContext: sampleUserContext,
    prompt: "Hi",
    kbFilters: noKb,
  }).response;
  await gateway.whenIdle();

  const factors = (
    {
      kind,
      userId,
      profileId,
      traceId,
    }: {
      kind: ETraceKind;
      userId?: string;
      profileId?: string;
      traceId: string;
    },
  ): unknown[] => [kind, userId, profileId, traceId];
  expect([
    usageAdapter.checkCalls.map(factors),
    usageAdapter.addUsageCalls.map(call => [...factors(call), call.usage.inputTokens]),
  ]).toEqual([
    [
      [ETraceKind.CHAT, sampleUserContext.userId, sampleProfile.id, "fake-trace-1"],
      [ETraceKind.MEMORY_WORKING, sampleUserContext.userId, sampleProfile.id, "fake-trace-2"],
    ],
    [
      [ETraceKind.CHAT, sampleUserContext.userId, sampleProfile.id, "fake-trace-1", 30],
      [ETraceKind.MEMORY_WORKING, sampleUserContext.userId, sampleProfile.id, "fake-trace-2", 10],
    ],
  ]);
});
