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
 * Claude on Amazon Bedrock takes the same split as Anthropic, with Bedrock's marker: one system message per block and a
 * `cachePoint` on the `cache` block. The Bedrock provider takes no marker on a tool definition, so the tools stay plain
 * even with `cacheTools`.
 */
test("Bedrock gets one system message per block, a cachePoint on the cache block and no tool marker", async () => {
  const {
    model,
    client,
  } = await makePromptCachingSetup(EModelProvider.BEDROCK);

  await client.complete({
    request: splitRequest({cacheTools: true}),
    meta,
    tools: twoTools,
  });

  const [cacheMessage] = model.doGenerateCalls[0].prompt.filter(message => message.role === "system");
  expect([systemMessagesOf(model).map(([text]) => text), cacheMessage?.providerOptions, toolsOf(model)]).toEqual([
    ["You are the assistant. Always mention the invoice number.", "Today is Thursday, 2026-10-01."],
    {bedrock: {cachePoint: {type: "default"}}},
    [["getInvoice", false], ["sendEmail", false]],
  ]);
});
