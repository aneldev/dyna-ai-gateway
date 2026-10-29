import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {ModelRegistry} from "../ModelRegistry";
import {EModelProvider} from "../types";
import {sampleModel} from "./utils/sampleModel";

/** `costCacheReadPerMTokUsd` and `costCacheWritePerMTokUsd` on the entry replace the provider defaults, on Anthropic too. */
test("estimateCostUsd uses the entry's cache prices over the provider defaults", async () => {
  const sample = sampleModel("model-a");
  const model = {
    ...sample,
    provider: EModelProvider.ANTHROPIC,
    caps: {
      ...sample.caps,
      costCacheReadPerMTokUsd: 0.5,
      costCacheWritePerMTokUsd: 3,
    },
  };
  const registry = new ModelRegistry({repository: new InMemoryModelRegistryRepository({models: [model]})});

  // 100k uncached × 1 + 500k read × 0.5 + 400k written × 3 = 0.1 + 0.25 + 1.2 = 1.55 USD
  expect(await registry.estimateCostUsd({
    modelId: "model-a",
    inputTokens: 1_000_000,
    outputTokens: 0,
    cachedInputTokens: 500_000,
    cacheWriteInputTokens: 400_000,
  })).toBeCloseTo(1.55, 10);
});
