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
 * A provider without cache markers (OpenAI caches on its own) gets the blocks joined as one system string and tools
 * without options, `cacheTools` or not: byte-for-byte the request before the blocks existed.
 */
test("OpenAI gets the blocks joined as one system string and unmarked tools", async () => {
  const {
    model,
    client,
  } = await makePromptCachingSetup(EModelProvider.OPENAI);

  await client.complete({
    request: splitRequest({cacheTools: true}),
    meta,
    tools: twoTools,
  });

  expect([systemMessagesOf(model), toolsOf(model)]).toEqual([
    [["You are the assistant. Always mention the invoice number.\n\nToday is Thursday, 2026-10-01.", false]],
    [["getInvoice", false], ["sendEmail", false]],
  ]);
});
