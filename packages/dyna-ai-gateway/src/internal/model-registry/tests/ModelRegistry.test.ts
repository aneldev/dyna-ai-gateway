import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {ModelRegistry} from "../ModelRegistry";
import {
  IModelInfo,
  EModelProvider,
} from "../types";

const makeModel = (modelId: string, overrides: Partial<IModelInfo> = {}): IModelInfo => ({
  id: modelId,
  provider: EModelProvider.OPENAI,
  providerModelId: `${modelId}-2026`,
  label: modelId,
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
  ...overrides,
});

interface ISetup {
  repository: InMemoryModelRegistryRepository;
  registry: ModelRegistry;
}

const setup = async (models: IModelInfo[], cacheTtlMs?: number): Promise<ISetup> => {
  const repository = new InMemoryModelRegistryRepository();
  for (const model of models) await repository.save({model});
  return {
    repository,
    registry: new ModelRegistry({
      repository,
      cacheTtlMs,
    }),
  };
};

describe("ModelRegistry", () => {
  describe("M1", () => {
    test("getModel returns the model saved in the repository", async () => {
      const {registry} = await setup([makeModel("model-a")]);
      expect(await registry.getModel({modelId: "model-a"})).toEqual(makeModel("model-a"));
    });

    test("getModel throws a 404 with code 5372567785992 for an unknown modelId", async () => {
      const {registry} = await setup([]);
      await expect(registry.getModel({modelId: "missing"})).rejects.toMatchObject({
        code: 5372567785992,
        status: 404,
        data: {modelId: "missing"},
      });
    });

    test("getModel throws a 400 with code 5372567786004 for a disabled model", async () => {
      const {registry} = await setup([makeModel("model-a", {enabled: false})]);
      await expect(registry.getModel({modelId: "model-a"})).rejects.toMatchObject({
        code: 5372567786004,
        status: 400,
        data: {modelId: "model-a"},
      });
    });

    test("getCaps returns the caps of the model", async () => {
      const {registry} = await setup([makeModel("model-a")]);
      expect(await registry.getCaps({modelId: "model-a"})).toEqual(makeModel("model-a").caps);
    });

    test("listModels returns enabled models only, by default", async () => {
      const {registry} = await setup([makeModel("model-a"), makeModel("model-b", {enabled: false})]);
      expect((await registry.listModels()).map(model => model.id)).toEqual(["model-a"]);
    });

    test("listModels includes disabled models when enabledOnly is false", async () => {
      const {registry} = await setup([makeModel("model-a"), makeModel("model-b", {enabled: false})]);
      expect((await registry.listModels({enabledOnly: false})).map(model => model.id)).toEqual(["model-a", "model-b"]);
    });

    test("listModels filters by provider", async () => {
      const {registry} = await setup([makeModel("model-a"), makeModel("model-b", {provider: EModelProvider.ANTHROPIC})]);
      expect((await registry.listModels({provider: EModelProvider.ANTHROPIC})).map(model => model.id)).toEqual(["model-b"]);
    });

    test("upsertModel makes the model available at once", async () => {
      const {registry} = await setup([]);
      await registry.listModels();
      await registry.upsertModel({model: makeModel("model-a")});
      expect(await registry.getModel({modelId: "model-a"})).toEqual(makeModel("model-a"));
    });

    test("getModel serves from the cache within cacheTtlMs", async () => {
      jest.useFakeTimers();
      const {
        repository,
        registry,
      } = await setup([makeModel("model-a", {label: "Cached"})], 60_000);
      await registry.getModel({modelId: "model-a"});
      await repository.save({model: makeModel("model-a", {label: "Changed in the repository"})});
      jest.advanceTimersByTime(59_000);
      expect((await registry.getModel({modelId: "model-a"})).label).toBe("Cached");
      jest.useRealTimers();
    });

    test("getModel reloads from the repository after cacheTtlMs", async () => {
      jest.useFakeTimers();
      const {
        repository,
        registry,
      } = await setup([makeModel("model-a", {label: "Cached"})], 60_000);
      await registry.getModel({modelId: "model-a"});
      await repository.save({model: makeModel("model-a", {label: "Reloaded"})});
      jest.advanceTimersByTime(60_000);
      expect((await registry.getModel({modelId: "model-a"})).label).toBe("Reloaded");
      jest.useRealTimers();
    });

    test("refresh reloads from the repository at once", async () => {
      const {
        repository,
        registry,
      } = await setup([makeModel("model-a", {label: "Cached"})]);
      await registry.getModel({modelId: "model-a"});
      await repository.save({model: makeModel("model-a", {label: "Reloaded"})});
      await registry.refresh();
      expect((await registry.getModel({modelId: "model-a"})).label).toBe("Reloaded");
    });

    test("changing a returned model does not change the registry", async () => {
      const {registry} = await setup([makeModel("model-a", {label: "Original"})]);
      const model = await registry.getModel({modelId: "model-a"});
      model.label = "Changed by the caller";
      expect((await registry.getModel({modelId: "model-a"})).label).toBe("Original");
    });
  });

  describe("M3 — estimateCostUsd", () => {
    test("is the input tokens at costInPerMTokUsd plus the output tokens at costOutPerMTokUsd, per million", async () => {
      const {registry} = await setup([makeModel("model-a")]);
      // 1M × 1 USD + 2M × 2 USD = 5 USD
      expect(await registry.estimateCostUsd({
        modelId: "model-a",
        inputTokens: 1_000_000,
        outputTokens: 2_000_000,
      })).toBe(5);
    });

    test("works for a disabled model", async () => {
      const {registry} = await setup([makeModel("model-a", {enabled: false})]);
      expect(await registry.estimateCostUsd({
        modelId: "model-a",
        inputTokens: 1_000_000,
        outputTokens: 0,
      })).toBe(1);
    });

    test("throws the 404 of an unknown model", async () => {
      const {registry} = await setup([]);
      await expect(registry.estimateCostUsd({
        modelId: "missing",
        inputTokens: 1,
        outputTokens: 1,
      })).rejects.toMatchObject({
        code: 5372567785992,
        status: 404,
      });
    });
  });
});
