import {MockLanguageModelV4} from "ai/test";

import {InMemoryUsageAdapter} from "../../../adapters/in-memory";

import {EModelProvider} from "../../model-registry";
import {ETraceKind} from "../../trace";
import {isUsageDeniedError} from "../../usage-guard";

import {createLanguageModel} from "../utils/createLanguageModel";
import {
  makeLLMClientSetup,
  makeModel,
  makeRequest,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createLanguageModel");

/**
 * The app says no: the provider is never called, nothing is traced, nothing is reported, and the client rejects with the
 * usage-denied error (429) that carries the app's code and user message unchanged.
 */
test("a check the adapter denies rejects with the usage-denied error and the provider is not called", async () => {
  const doGenerate = jest.fn();
  jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({doGenerate}));
  const usageAdapter = new InMemoryUsageAdapter({
    deny: () => ({
      approved: false,
      denyCode: "daily_limit_reached",
      denyUserMessage: "Your daily limit is reached.",
    }),
  });
  const setup = await makeLLMClientSetup([makeModel("model-a", EModelProvider.OPENAI)], {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}}, usageAdapter);

  const error: unknown = await setup.client.complete({
    request: makeRequest(),
    meta: {
      tenantId: "tenant-a",
      userId: "user-a",
      kind: ETraceKind.CHAT,
    },
  }).catch((caught: unknown) => caught);

  const entries = await setup.trace.query({
    tenantId: "tenant-a",
    filters: {},
    skip: 0,
    limit: 10,
  });
  expect([
    isUsageDeniedError(error),
    isUsageDeniedError(error) && [error.status, error.userMessage, error.data.denyCode, error.data.traceId === usageAdapter.checkCalls[0]?.traceId],
    doGenerate.mock.calls.length,
    usageAdapter.addUsageCalls.length,
    entries.length,
  ]).toEqual([
    true,
    [429, "Your daily limit is reached.", "daily_limit_reached", true],
    0,
    0,
    0,
  ]);
});
