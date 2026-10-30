import {MockLanguageModelV4} from "ai/test";
import {z} from "zod";

import {IToolDef} from "../../../../contracts";

import {EModelProvider} from "../../../model-registry";

import {LLMClient} from "../../LLMClient";
import {IModelRequest} from "../../types";
import {createLanguageModel} from "../../utils/createLanguageModel";

import {
  makeLLMClient,
  makeModel,
  makeRequest,
} from "./llmClientFixtures";

/** A request whose system prompt is split: a `cache` block and a per-call block. */
export const splitRequest = (overrides: Partial<IModelRequest> = {}): IModelRequest => makeRequest({
  system: [
    {
      text: "You are the assistant. Always mention the invoice number.",
      cache: true,
    },
    {text: "Today is Thursday, 2026-10-01."},
  ],
  ...overrides,
});

/** Two tool definitions, so the marker on "the last tool" is distinguishable from one on every tool. */
export const twoTools: IToolDef[] = [
  {
    name: "getInvoice",
    description: "Gets an invoice",
    inputSchema: z.object({id: z.string()}),
    execute: async () => ({}),
    tags: [],
  },
  {
    name: "sendEmail",
    description: "Sends an email",
    inputSchema: z.object({to: z.string()}),
    execute: async () => ({}),
    tags: [],
  },
];

/**
 * A mock model that answers "ok" behind the mocked `createLanguageModel`, and a client on `model-a` of the given provider.
 * The test file must `jest.mock("../utils/createLanguageModel")` itself: jest hoists the mock per test file.
 */
export const makePromptCachingSetup = async (provider: EModelProvider): Promise<{ model: MockLanguageModelV4; client: LLMClient }> => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: "ok",
        },
      ],
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
          total: 1,
          text: 1,
          reasoning: undefined,
        },
      },
      warnings: [],
    }),
  });
  jest.mocked(createLanguageModel).mockReturnValue(model);
  const client = await makeLLMClient([makeModel("model-a", provider)], {providers: {[provider]: {apiKey: "test-key"}}});
  return {
    model,
    client,
  };
};

/** The system messages of the prompt the mock model received, as `[content, has a cache marker]`. */
export const systemMessagesOf = (model: MockLanguageModelV4): [string, boolean][] =>
  model.doGenerateCalls[0].prompt
    .filter(message => message.role === "system")
    .map(message => [
      message.role === "system" ? message.content : "",
      message.providerOptions?.anthropic?.cacheControl !== undefined,
    ]);

/** The tools the mock model received, as `[name, has a cache marker]`. */
export const toolsOf = (model: MockLanguageModelV4): [string, boolean][] =>
  (model.doGenerateCalls[0].tools ?? []).map(sdkTool => [
    sdkTool.name,
    sdkTool.type === "function" && sdkTool.providerOptions?.anthropic?.cacheControl !== undefined,
  ]);

/** The call-level provider options the mock model received (`promptCacheKey` lives in `openai`). */
export const providerOptionsOf = (model: MockLanguageModelV4): Record<string, Record<string, unknown>> | undefined =>
  model.doGenerateCalls[0].providerOptions;
