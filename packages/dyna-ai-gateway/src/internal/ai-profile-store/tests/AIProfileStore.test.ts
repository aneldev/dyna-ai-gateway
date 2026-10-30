import {z} from "zod";

import {
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
  InMemoryRunRepository,
} from "../../../adapters/in-memory";
import {
  IToolDef,
  EToolCallVerdict,
} from "../../../contracts";

import {
  IModelInfo,
  ModelRegistry,
  EModelProvider,
} from "../../model-registry";
import {RunStore} from "../../run-store";
import {ToolRegistry} from "../../tool-registry";
import {SkillRegistry} from "../../skill-registry";

import {AIProfileStore} from "../AIProfileStore";
import {IAIProfile} from "../types";

const makeModel = (modelId: string, enabled = true): IModelInfo => ({
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
  enabled,
  deprecatedAt: null,
});

const makeProfile = (tenantId: string, profileId: string, overrides: Partial<IAIProfile> = {}): IAIProfile => ({
  id: profileId,
  tenantId,
  name: profileId,
  modelId: "model-a",
  allowedTools: [],
  approvals: [],
  promptAddendum: "",
  limits: {
    maxStepsPerRun: 5,
    maxOutputTokens: 500,
  },
  ...overrides,
});

const refundTool: IToolDef = {
  name: "refund",
  description: "Refunds an invoice",
  inputSchema: z.object({invoiceId: z.string()}),
  tags: [],
  policy: EToolCallVerdict.NEEDS_APPROVAL,
  execute: async (): Promise<unknown> => ({ok: true}),
};

interface ISetup {
  repository: InMemoryAIProfileRepository;
  store: AIProfileStore;
}

const setup = async (profiles: IAIProfile[], cacheTtlMs?: number): Promise<ISetup> => {
  const modelRepository = new InMemoryModelRegistryRepository();
  await modelRepository.save({model: makeModel("model-a")});
  await modelRepository.save({model: makeModel("model-disabled", false)});
  const repository = new InMemoryAIProfileRepository();
  for (const profile of profiles) {
    await repository.save({
      tenantId: profile.tenantId,
      profile,
    });
  }
  return {
    repository,
    store: new AIProfileStore(
      {
        repository,
        cacheTtlMs,
      },
      {
        modelRegistry: new ModelRegistry({repository: modelRepository}),
        toolRegistry: new ToolRegistry({tools: [refundTool]}),
        runStore: new RunStore({repository: new InMemoryRunRepository()}),
        skillRegistry: new SkillRegistry({}),
      },
    ),
  };
};

const upsert = (store: AIProfileStore, profile: IAIProfile): Promise<void> =>
  store.upsertProfile({
    tenantId: profile.tenantId,
    profile,
  });

describe("AIProfileStore", () => {
  describe("M1", () => {
    test("getProfile returns the profile of the tenant", async () => {
      const {store} = await setup([makeProfile("tenant-a", "careful")]);
      expect(await store.getProfile({
        tenantId: "tenant-a",
        profileId: "careful",
      })).toEqual(makeProfile("tenant-a", "careful"));
    });

    test("getProfile throws a 404 with code 5372567786127 for an unknown profileId", async () => {
      const {store} = await setup([]);
      await expect(store.getProfile({
        tenantId: "tenant-a",
        profileId: "missing",
      })).rejects.toMatchObject({
        code: 5372567786127,
        status: 404,
        data: {
          tenantId: "tenant-a",
          profileId: "missing",
        },
      });
    });

    test("getProfile does not return a profile of another tenant", async () => {
      const {store} = await setup([makeProfile("tenant-a", "careful")]);
      await expect(store.getProfile({
        tenantId: "tenant-b",
        profileId: "careful",
      })).rejects.toMatchObject({code: 5372567786127});
    });

    test("upsertProfile saves the profile and makes it available at once", async () => {
      const {store} = await setup([]);
      await store.getProfile({
        tenantId: "tenant-a",
        profileId: "careful",
      }).catch(() => undefined);
      await upsert(store, makeProfile("tenant-a", "careful"));
      expect(await store.getProfile({
        tenantId: "tenant-a",
        profileId: "careful",
      })).toEqual(makeProfile("tenant-a", "careful"));
    });

    test("upsertProfile replaces the profile with the same profileId", async () => {
      const {store} = await setup([makeProfile("tenant-a", "careful", {name: "Old"})]);
      await upsert(store, makeProfile("tenant-a", "careful", {name: "New"}));
      expect((await store.getProfile({
        tenantId: "tenant-a",
        profileId: "careful",
      })).name).toBe("New");
    });

    test("upsertProfile refuses an unknown modelId with the registry's 404", async () => {
      const {
        repository,
        store,
      } = await setup([]);
      await expect(upsert(store, makeProfile("tenant-a", "careful", {modelId: "missing"}))).rejects.toMatchObject({
        code: 5372567785992,
        status: 404,
      });
      expect(await repository.loadByTenant({tenantId: "tenant-a"})).toEqual([]);
    });

    test("upsertProfile refuses a disabled modelId with the registry's 400", async () => {
      const {store} = await setup([]);
      await expect(upsert(store, makeProfile("tenant-a", "careful", {modelId: "model-disabled"}))).rejects.toMatchObject({
        code: 5372567786004,
        status: 400,
      });
    });

    test("upsertProfile refuses an unknown cheapModelId", async () => {
      const {store} = await setup([]);
      await expect(upsert(store, makeProfile("tenant-a", "careful", {cheapModelId: "missing"}))).rejects.toMatchObject({code: 5372567785992});
    });

    test("upsertProfile accepts allowedTools and approvals that are registered tools", async () => {
      const {store} = await setup([]);
      await upsert(store, makeProfile("tenant-a", "careful", {
        allowedTools: ["refund"],
        approvals: ["refund"],
      }));
      expect((await store.getProfile({
        tenantId: "tenant-a",
        profileId: "careful",
      })).allowedTools).toEqual(["refund"]);
    });

    test("upsertProfile refuses an allowed tool that is not registered, with code 5372567786250", async () => {
      const {store} = await setup([]);
      await expect(upsert(store, makeProfile("tenant-a", "careful", {allowedTools: ["refund", "send_email"]}))).rejects.toMatchObject({
        code: 5372567786250,
        status: 400,
        data: {unknownTools: ["send_email"]},
      });
    });

    test("upsertProfile refuses an approval for a tool that is not registered", async () => {
      const {store} = await setup([]);
      await expect(upsert(store, makeProfile("tenant-a", "careful", {approvals: ["send_email"]}))).rejects.toMatchObject({code: 5372567786250});
    });

    test("getProfile serves from the cache within cacheTtlMs", async () => {
      jest.useFakeTimers();
      const {
        repository,
        store,
      } = await setup([makeProfile("tenant-a", "careful", {name: "Cached"})], 30_000);
      await store.getProfile({
        tenantId: "tenant-a",
        profileId: "careful",
      });
      await repository.save({
        tenantId: "tenant-a",
        profile: makeProfile("tenant-a", "careful", {name: "Changed in the repository"}),
      });
      jest.advanceTimersByTime(29_000);
      expect((await store.getProfile({
        tenantId: "tenant-a",
        profileId: "careful",
      })).name).toBe("Cached");
      jest.useRealTimers();
    });

    test("getProfile reloads from the repository after cacheTtlMs", async () => {
      jest.useFakeTimers();
      const {
        repository,
        store,
      } = await setup([makeProfile("tenant-a", "careful", {name: "Cached"})], 30_000);
      await store.getProfile({
        tenantId: "tenant-a",
        profileId: "careful",
      });
      await repository.save({
        tenantId: "tenant-a",
        profile: makeProfile("tenant-a", "careful", {name: "Reloaded"}),
      });
      jest.advanceTimersByTime(30_000);
      expect((await store.getProfile({
        tenantId: "tenant-a",
        profileId: "careful",
      })).name).toBe("Reloaded");
      jest.useRealTimers();
    });
  });
});
