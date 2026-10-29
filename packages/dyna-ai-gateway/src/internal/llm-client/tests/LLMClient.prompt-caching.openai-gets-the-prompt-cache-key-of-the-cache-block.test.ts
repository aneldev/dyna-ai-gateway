import {EModelProvider} from "../../model-registry";

import {meta} from "./utils/llmClientFixtures";
import {
  makePromptCachingSetup,
  providerOptionsOf,
  splitRequest,
} from "./utils/promptCachingFixtures";

jest.mock("../utils/createLanguageModel");

/**
 * On OpenAI a request with a `cache` block carries `openai.promptCacheKey`: the first 16 hex characters of the SHA-256 of
 * the block's text, so OpenAI routes the calls that share the stable block to one cache. The key is pinned to a fixed
 * text: a changed hash or length would silently split the cache.
 */
test("OpenAI gets promptCacheKey = the 16-hex SHA-256 of the cache block's text", async () => {
  const {
    model,
    client,
  } = await makePromptCachingSetup(EModelProvider.OPENAI);

  await client.complete({
    request: splitRequest(),
    meta,
  });

  // SHA-256 of "You are the assistant. Always mention the invoice number.") starts with 47cf119bffaabef3
  expect(providerOptionsOf(model)).toEqual({openai: {promptCacheKey: "47cf119bffaabef3"}});
});
