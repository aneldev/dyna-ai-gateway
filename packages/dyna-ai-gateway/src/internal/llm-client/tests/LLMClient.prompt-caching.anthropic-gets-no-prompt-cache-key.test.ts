import {EModelProvider} from "../../model-registry";

import {meta} from "./utils/llmClientFixtures";
import {
  makePromptCachingSetup,
  providerOptionsOf,
  splitRequest,
} from "./utils/promptCachingFixtures";

jest.mock("../utils/createLanguageModel");

/** The key is OpenAI's routing hint; Anthropic matches the prefix itself, so an Anthropic request with a `cache` block carries no call-level provider options. */
test("Anthropic with a cache block gets no call-level providerOptions", async () => {
  const {
    model,
    client,
  } = await makePromptCachingSetup(EModelProvider.ANTHROPIC);

  await client.complete({
    request: splitRequest(),
    meta,
  });

  expect(providerOptionsOf(model)).toBeUndefined();
});
