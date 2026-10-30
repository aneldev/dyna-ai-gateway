import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {ModelRegistry} from "../ModelRegistry";
import {sampleModel} from "./utils/sampleModel";

/** A non-Anthropic model without `costCacheReadPerMTokUsd` prices cached tokens at the input price: the gateway never assumes a discount it does not know. */
test("estimateCostUsd on OpenAI without a cache price charges a cache read at the full input price", async () => {
  const registry = new ModelRegistry({repository: new InMemoryModelRegistryRepository({models: [sampleModel("model-a")]})});

  // 1M × 1 USD, cached or not
  expect(await registry.estimateCostUsd({
    modelId: "model-a",
    inputTokens: 1_000_000,
    outputTokens: 0,
    cachedInputTokens: 800_000,
  })).toBe(1);
});
