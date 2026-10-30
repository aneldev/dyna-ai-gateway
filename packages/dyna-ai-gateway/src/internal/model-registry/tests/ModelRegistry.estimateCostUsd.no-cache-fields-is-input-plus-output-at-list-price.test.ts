import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {ModelRegistry} from "../ModelRegistry";
import {sampleModel} from "./utils/sampleModel";

/** Without cache fields the estimate is the one before prompt caching existed: input × costIn + output × costOut, per million. */
test("estimateCostUsd without cache fields is input at costIn plus output at costOut", async () => {
  const registry = new ModelRegistry({repository: new InMemoryModelRegistryRepository({models: [sampleModel("model-a")]})});

  // 1M × 1 USD + 2M × 2 USD = 5 USD
  expect(await registry.estimateCostUsd({
    modelId: "model-a",
    inputTokens: 1_000_000,
    outputTokens: 2_000_000,
  })).toBe(5);
});
