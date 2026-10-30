import {EModelProvider} from "../../model-registry";

import {
  makeRequest,
  meta,
} from "./utils/llmClientFixtures";
import {
  makePromptCachingSetup,
  providerOptionsOf,
} from "./utils/promptCachingFixtures";

jest.mock("../utils/createLanguageModel");

/** Without a `cache` block (caching off, a system job, a template without the breakpoint) OpenAI gets no provider options at all: the request of before. */
test("OpenAI without a cache block gets no providerOptions", async () => {
  const {
    model,
    client,
  } = await makePromptCachingSetup(EModelProvider.OPENAI);

  await client.complete({
    request: makeRequest({system: [{text: "You are a test"}, {text: "Today is Thursday."}]}),
    meta,
  });

  expect(providerOptionsOf(model)).toBeUndefined();
});
