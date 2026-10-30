import {MockLanguageModelV4} from "ai/test";

import {InMemoryUsageAdapter} from "../../../adapters/in-memory";

import {EModelProvider} from "../../model-registry";
import {ETraceKind} from "../../trace";

import {ILLMClientCallMeta} from "../types";
import {createLanguageModel} from "../utils/createLanguageModel";
import {
  makeLLMClientSetup,
  makeModel,
  makeRequest,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createLanguageModel");

const meta: ILLMClientCallMeta = {
  tenantId: "tenant-a",
  userId: "user-a",
  profileId: "default",
  threadId: "thread-1",
  runId: "run-1",
  kind: ETraceKind.RUN_STEP,
};

/**
 * Around one provider call the client asks the app once and tells it once: the check carries every factor of the call and the
 * tokenized size of the request ("You are a test" + "hi" = 5 tokens for the model's provider, output = maxOutputTokens), the report carries the same
 * factors, the usage the provider reported and the list-price cost (10 × 1 + 2 × 2 USD per million). The two share the trace id
 * of the entry the call left.
 */
test("a complete asks the adapter with the call's factors and reports the usage under the same trace id", async () => {
  jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{
        type: "text",
        text: "hello",
      }],
      finishReason: {
        unified: "stop",
        raw: undefined,
      },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 2,
          text: 2,
          reasoning: undefined,
        },
      },
      warnings: [],
    }),
  }));
  const usageAdapter = new InMemoryUsageAdapter();
  const setup = await makeLLMClientSetup([makeModel("model-a", EModelProvider.OPENAI)], {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}}, usageAdapter);

  const result = await setup.client.complete({
    request: makeRequest(),
    meta,
  });

  const [check] = usageAdapter.checkCalls;
  const [report] = usageAdapter.addUsageCalls;
  const entries = await setup.trace.query({
    tenantId: "tenant-a",
    filters: {},
    skip: 0,
    limit: 10,
  });
  expect([check, report && {
    ...report,
    date: report.date instanceof Date,
  }, entries.map(entry => entry.id)]).toEqual([
    {
      ...meta,
      traceId: result.traceId,
      modelId: "model-a",
      neededTokens: {
        input: 5,
        output: 500,
      },
    },
    {
      ...meta,
      traceId: result.traceId,
      modelId: "model-a",
      date: true,
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: undefined,
        cacheWriteInputTokens: undefined,
      },
      costUsd: (10 * 1 + 2 * 2) / 1_000_000,
    },
    [result.traceId],
  ]);
});
