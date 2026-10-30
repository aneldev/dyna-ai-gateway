import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {ModelRegistry} from "../ModelRegistry";
import {EModelProvider} from "../types";
import {sampleModel} from "./utils/sampleModel";

/** A provider that reports more cached tokens than `inputTokens` yields zero uncached tokens, never a negative count that lowers the cost. */
test("estimateCostUsd clamps the uncached tokens at zero when the cache counts exceed the total", async () => {
  const model = {
    ...sampleModel("model-a"),
    provider: EModelProvider.ANTHROPIC,
  };
  const registry = new ModelRegistry({repository: new InMemoryModelRegistryRepository({models: [model]})});

  // 0 uncached + 800k read × 0.1 + 400k written × 1.25 = 0.08 + 0.5 = 0.58 USD
  expect(await registry.estimateCostUsd({
    modelId: "model-a",
    inputTokens: 1_000_000,
    outputTokens: 0,
    cachedInputTokens: 800_000,
    cacheWriteInputTokens: 400_000,
  })).toBeCloseTo(0.58, 10);
});
