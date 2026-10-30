import {EModelProvider} from "../../model-registry";

import {meta} from "./utils/llmClientFixtures";
import {
  makePromptCachingSetup,
  splitRequest,
  systemMessagesOf,
  toolsOf,
  twoTools,
} from "./utils/promptCachingFixtures";

jest.mock("../utils/createLanguageModel");

/**
 * On Anthropic a split prompt is sent as one system message per block, the `cache` block carrying `cache_control`, and with
 * `cacheTools` the last tool definition carries it too: the provider caches the tools and the stable block, and reads them
 * on the next call of the profile.
 */
test("Anthropic gets one system message per block, the marker on the cache block and on the last tool", async () => {
  const {
    model,
    client,
  } = await makePromptCachingSetup(EModelProvider.ANTHROPIC);

  await client.complete({
    request: splitRequest({cacheTools: true}),
    meta,
    tools: twoTools,
  });

  expect([systemMessagesOf(model), toolsOf(model)]).toEqual([
    [
      ["You are the assistant. Always mention the invoice number.", true],
      ["Today is Thursday, 2026-10-01.", false],
    ],
    [["getInvoice", false], ["sendEmail", true]],
  ]);
});
