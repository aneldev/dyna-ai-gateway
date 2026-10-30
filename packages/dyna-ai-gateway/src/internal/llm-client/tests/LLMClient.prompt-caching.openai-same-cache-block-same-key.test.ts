import {EModelProvider} from "../../model-registry";

import {meta} from "./utils/llmClientFixtures";
import {
  makePromptCachingSetup,
  splitRequest,
} from "./utils/promptCachingFixtures";

jest.mock("../utils/createLanguageModel");

/** Two calls whose `cache` block is identical get the same key whatever their per-call block says: the key names the stable block only. */
test("OpenAI calls with the same cache block and different per-call blocks get the same promptCacheKey", async () => {
  const {
    model,
    client,
  } = await makePromptCachingSetup(EModelProvider.OPENAI);

  await client.complete({
    request: splitRequest(),
    meta,
  });
  await client.complete({
    request: splitRequest({system: [splitRequest().system[0], {text: "Today is Friday, 2026-10-02."}]}),
    meta,
  });

  const keys = model.doGenerateCalls.map(call => call.providerOptions?.openai?.promptCacheKey);
  expect([keys.length, keys[0] === keys[1], typeof keys[0]]).toEqual([2, true, "string"]);
});
