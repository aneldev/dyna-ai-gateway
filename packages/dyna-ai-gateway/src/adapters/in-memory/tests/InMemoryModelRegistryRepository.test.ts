import {
  IModelInfo,
  EModelProvider,
} from "../../../internal/model-registry";

import {InMemoryModelRegistryRepository} from "../InMemoryModelRegistryRepository";

const makeModel = (modelId: string, label = "Model"): IModelInfo => ({
  id: modelId,
  provider: EModelProvider.OPENAI,
  providerModelId: `${modelId}-2026`,
  label,
  caps: {
    tools: true,
    images: false,
    pdf: false,
    structuredOutput: true,
    reasoning: false,
    temperature: true,
    embeddings: false,
    contextTokens: 128_000,
    maxOutputTokens: 4_000,
    costInPerMTokUsd: 1,
    costOutPerMTokUsd: 2,
  },
  enabled: true,
  deprecatedAt: null,
});

describe("InMemoryModelRegistryRepository", () => {
  test("loadAll returns an empty list when nothing is saved", async () => {
    const repository = new InMemoryModelRegistryRepository();
    expect(await repository.loadAll()).toEqual([]);
  });

  test("loadAll returns the saved models", async () => {
    const repository = new InMemoryModelRegistryRepository();
    await repository.save({model: makeModel("model-a")});
    await repository.save({model: makeModel("model-b")});
    expect(await repository.loadAll()).toEqual([makeModel("model-a"), makeModel("model-b")]);
  });

  test("save replaces the model with the same modelId", async () => {
    const repository = new InMemoryModelRegistryRepository();
    await repository.save({model: makeModel("model-a", "Old")});
    await repository.save({model: makeModel("model-a", "New")});
    expect(await repository.loadAll()).toEqual([makeModel("model-a", "New")]);
  });

  test("remove deletes the model", async () => {
    const repository = new InMemoryModelRegistryRepository();
    await repository.save({model: makeModel("model-a")});
    await repository.remove({modelId: "model-a"});
    expect(await repository.loadAll()).toEqual([]);
  });

  test("changing a model after save does not change the stored one", async () => {
    const repository = new InMemoryModelRegistryRepository();
    const model = makeModel("model-a", "Saved");
    await repository.save({model});
    model.label = "Changed later";
    expect((await repository.loadAll())[0].label).toBe("Saved");
  });

  test("the models given to the constructor are loaded like saved ones, as copies", async () => {
    const seed = makeModel("model-a");
    const repository = new InMemoryModelRegistryRepository({models: [seed]});
    seed.label = "changed after construction";
    expect(await repository.loadAll()).toEqual([makeModel("model-a")]);
  });
});
