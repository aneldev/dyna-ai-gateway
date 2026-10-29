import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {ModelRegistry} from "../ModelRegistry";
import {EModelProvider} from "../types";
import {sampleModel} from "./utils/sampleModel";

/** An Anthropic model without `costCacheReadPerMTokUsd` prices a cache read at 0.1 × the input price; the uncached rest stays at the input price. */
test("estimateCostUsd on Anthropic prices a cache read at a tenth of the input price by default", async () => {
  const model = {
    ...sampleModel("model-a"),
    provider: EModelProvider.ANTHROPIC,
  };
  const registry = new ModelRegistry({repository: new InMemoryModelRegistryRepository({models: [model]})});

  // 200k uncached × 1 USD + 800k read × 0.1 USD = 0.28 USD
  expect(await registry.estimateCostUsd({
    modelId: "model-a",
    inputTokens: 1_000_000,
    outputTokens: 0,
    cachedInputTokens: 800_000,
  })).toBeCloseTo(0.28, 10);
});
