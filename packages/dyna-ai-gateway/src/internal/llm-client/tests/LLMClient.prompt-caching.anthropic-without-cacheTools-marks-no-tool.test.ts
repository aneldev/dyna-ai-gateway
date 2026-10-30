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
 * Without `cacheTools` (the cache is not shared across tenants) the tool definitions get no marker: they are the same
 * for every tenant, so a marker there would be a cache entry every tenant reads. The system blocks are still marked.
 */
test("Anthropic without cacheTools marks the cache block and no tool", async () => {
  const {
    model,
    client,
  } = await makePromptCachingSetup(EModelProvider.ANTHROPIC);

  await client.complete({
    request: splitRequest(),
    meta,
    tools: twoTools,
  });

  expect([systemMessagesOf(model).map(([, marked]) => marked), toolsOf(model)]).toEqual([
    [true, false],
    [["getInvoice", false], ["sendEmail", false]],
  ]);
});
