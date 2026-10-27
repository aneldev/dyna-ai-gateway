import {APICallError} from "ai";
import {MockLanguageModelV4} from "ai/test";

import {EModelProvider} from "../../model-registry";

import {createLanguageModel} from "../utils/createLanguageModel";
import {
  makeLLMClient,
  makeModel,
  makeRequest,
  meta,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createLanguageModel");

/**
 * The AI SDK's error carries the request it sent (system prompt, user facts, transcript, files), and a JSON logger writes
 * the 502 whole. The gateway's 502 keeps the provider's message and status, never the request — also through the retries.
 */
test("a provider failure after a retry is a 502 whose error, serialised, holds no request body", async () => {
  const secret = "SYSTEM PROMPT: the user lives in Vienna";
  jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({
    doGenerate: async () => {
      throw new APICallError({
        message: "Too many requests",
        url: "https://api.openai.com/v1/responses",
        requestBodyValues: {system: secret},
        statusCode: 429,
        isRetryable: true,
      });
    },
  }));
  const client = await makeLLMClient([makeModel("model-a", EModelProvider.OPENAI)], {
    providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}},
    maxRetries: 1,
  });

  const error: unknown = await client.complete({
    request: makeRequest(),
    meta,
  }).catch((thrown: unknown) => thrown);

  const serialised = JSON.stringify(error);
  expect([
    (error as {status?: number}).status,
    serialised.includes(secret),
    serialised.includes("Too many requests"),
    serialised.includes("429"),
  ]).toEqual([502, false, true, true]);
});
