import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {ModelRegistry} from "../ModelRegistry";
import {sampleModel} from "./utils/sampleModel";

/** `removeModel` deletes the entry and drops the cache: the model is unknown at once, even to `listModels({enabledOnly: false})`; an unknown model is a 404. */
test("removeModel deletes the entry, and a second removal is a 404", async () => {
  const repository = new InMemoryModelRegistryRepository({models: [sampleModel("model-a"), sampleModel("model-b")]});
  const registry = new ModelRegistry({repository});
  await registry.getModel({modelId: "model-a"});

  await registry.removeModel({modelId: "model-a"});
  const listed = await registry.listModels({enabledOnly: false});
  const again = registry.removeModel({modelId: "model-a"});

  await expect(again).rejects.toMatchObject({
    code: 5372567785992,
    status: 404,
  });
  expect(listed.map(model => model.id)).toEqual(["model-b"]);
});
