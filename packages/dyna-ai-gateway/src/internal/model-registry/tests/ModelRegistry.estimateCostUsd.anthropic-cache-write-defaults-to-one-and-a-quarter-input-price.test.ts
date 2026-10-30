import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {ModelRegistry} from "../ModelRegistry";
import {EModelProvider} from "../types";
import {sampleModel} from "./utils/sampleModel";

/** An Anthropic model without `costCacheWritePerMTokUsd` prices a cache write at 1.25 × the input price: the first call of a profile costs more, not less. */
test("estimateCostUsd on Anthropic prices a cache write at 1.25 times the input price by default", async () => {
  const model = {
    ...sampleModel("model-a"),
    provider: EModelProvider.ANTHROPIC,
  };
  const registry = new ModelRegistry({repository: new InMemoryModelRegistryRepository({models: [model]})});

  // 200k uncached × 1 USD + 800k written × 1.25 USD = 1.2 USD
  expect(await registry.estimateCostUsd({
    modelId: "model-a",
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheWriteInputTokens: 800_000,
  })).toBeCloseTo(1.2, 10);
});
