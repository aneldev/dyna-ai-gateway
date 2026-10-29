import {EModelProvider} from "../../model-registry";

import {
  makeRequest,
  meta,
} from "./utils/llmClientFixtures";
import {
  makePromptCachingSetup,
  systemMessagesOf,
} from "./utils/promptCachingFixtures";

jest.mock("../utils/createLanguageModel");

/** Anthropic with no `cache` block (caching off, or a template without the breakpoint) gets the texts joined as one string, no marker. */
test("Anthropic without a cache block gets the blocks joined as one unmarked string", async () => {
  const {
    model,
    client,
  } = await makePromptCachingSetup(EModelProvider.ANTHROPIC);

  await client.complete({
    request: makeRequest({system: [{text: "You are a test"}, {text: "Today is Thursday."}]}),
    meta,
  });

  expect(systemMessagesOf(model)).toEqual([["You are a test\n\nToday is Thursday.", false]]);
});
