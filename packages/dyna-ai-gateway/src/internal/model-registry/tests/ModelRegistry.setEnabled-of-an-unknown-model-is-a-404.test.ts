import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {ModelRegistry} from "../ModelRegistry";

/** The flag of a model that does not exist cannot be set: the 404 of `getModel`, and nothing is written. */
test("setEnabled of an unknown model is a 404 and stores nothing", async () => {
  const repository = new InMemoryModelRegistryRepository();
  const registry = new ModelRegistry({repository});

  await expect(registry.setEnabled({
    modelId: "missing",
    enabled: false,
  })).rejects.toMatchObject({
    code: 5372567785992,
    status: 404,
  });
  expect(await repository.loadAll()).toEqual([]);
});
