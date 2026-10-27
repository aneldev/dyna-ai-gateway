import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {ModelRegistry} from "../ModelRegistry";
import {sampleModel} from "./utils/sampleModel";

/** `setEnabled` flips the flag of the stored entry and drops the cache: `getModel` refuses it at once, `listModels` still lists it, and it comes back the same way. */
test("setEnabled switches a model off, getModel refuses it, and switches it on again", async () => {
  const repository = new InMemoryModelRegistryRepository({models: [sampleModel("model-a")]});
  const registry = new ModelRegistry({repository});
  await registry.getModel({modelId: "model-a"});

  await registry.setEnabled({
    modelId: "model-a",
    enabled: false,
  });
  const refused = registry.getModel({modelId: "model-a"});
  const listed = await registry.listModels({enabledOnly: false});
  await registry.setEnabled({
    modelId: "model-a",
    enabled: true,
  });
  const back = await registry.getModel({modelId: "model-a"});

  await expect(refused).rejects.toMatchObject({
    code: 5372567786004,
    status: 400,
  });
  expect([
    listed.map(model => [model.id, model.enabled]),
    back.enabled,
  ]).toEqual([
    [["model-a", false]],
    true,
  ]);
});
