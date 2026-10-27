import {MockLanguageModelV4} from "ai/test";

import {InMemoryUsageAdapter} from "../../../adapters/in-memory";

import {EModelProvider} from "../../model-registry";
import {ETraceKind} from "../../trace";

import {createLanguageModel} from "../utils/createLanguageModel";
import {
  makeLLMClientSetup,
  makeModel,
  makeRequest,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createLanguageModel");

/**
 * The app approved, then the provider failed: the client still tells the app, with zero usage and the trace id of the check,
 * so an adapter that reserved in `check` can settle. The call itself is the 502 it always was, and nothing is traced.
 */
test("a provider failure after an approved check is reported with zero usage under the check's trace id", async () => {
  jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("provider is down");
    },
  }));
  const usageAdapter = new InMemoryUsageAdapter();
  const setup = await makeLLMClientSetup([makeModel("model-a", EModelProvider.OPENAI)], {
    providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}},
    maxRetries: 0,
  }, usageAdapter);

  const error: unknown = await setup.client.complete({
    request: makeRequest(),
    meta: {
      tenantId: "tenant-a",
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
    (error as {status?: number}).status,
    usageAdapter.addUsageCalls.map(call => [call.traceId === usageAdapter.checkCalls[0]?.traceId, call.usage, call.costUsd]),
    entries.length,
  ]).toEqual([
    502,
    [[true, {
      inputTokens: 0,
      outputTokens: 0,
    }, 0]],
    0,
  ]);
});
