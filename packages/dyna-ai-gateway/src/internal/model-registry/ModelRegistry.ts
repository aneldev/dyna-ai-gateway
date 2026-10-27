import {dynaError} from "dyna-error";

import {
  IModelCaps,
  IModelInfo,
  IModelRegistry,
  IModelRegistryConfig,
  EModelProvider,
} from "./types";

const DEFAULT_CACHE_TTL_MS = 60_000;
const TOKENS_PER_MILLION = 1_000_000;

interface ICatalogCache {
  models: Map<string, IModelInfo>;
  loadedAt: number;
}

/** Global catalog of usable models: facts, not tenant choices. Global by design; no tenantId. */
export class ModelRegistry implements IModelRegistry {
  private cache: ICatalogCache | null = null;

  constructor(private readonly config: IModelRegistryConfig) {
  }

  /** Resolves one model; throws if unknown or disabled. Cached. */
  public async getModel(
    {modelId}: {modelId: string},
  ): Promise<IModelInfo> {
    const model = await this.findModel(modelId);
    if (!model.enabled) {
      throw dynaError({
        code: 5372567786004,
        status: 400,
        message: `ModelRegistry: model is disabled [${modelId}]`,
        data: {modelId},
      });
    }
    return structuredClone(model);
  }

  /** Lists models for admin UI or profile editors. Cached. */
  public async listModels(
    {
      enabledOnly = true,
      provider,
    }: {
      /** Skip disabled entries. Default true. */
      enabledOnly?: boolean;
      /** Filter by provider. */
      provider?: EModelProvider;
    } = {},
  ): Promise<IModelInfo[]> {
    return [...(await this.getCatalog()).values()]
      .filter(model => !enabledOnly || model.enabled)
      .filter(model => provider === undefined || model.provider === provider)
      .map(model => structuredClone(model));
  }

  /** Shortcut for callers that only need capabilities (Assembler, ToolPolicy). */
  public async getCaps(
    {modelId}: {modelId: string},
  ): Promise<IModelCaps> {
    return (await this.getModel({modelId})).caps;
  }

  /**
   * USD estimate for a call; the LLMClient reports it to the UsageGuard and the trace after every call.
   * Works for a disabled model too: a call that was in flight when the model got disabled is still reported.
   */
  public async estimateCostUsd(
    {
      modelId,
      inputTokens,
      outputTokens,
    }: {
      /** Our model id. */
      modelId: string;
      /** Prompt tokens. */
      inputTokens: number;
      /** Completion tokens. */
      outputTokens: number;
    },
  ): Promise<number> {
    const {caps} = await this.findModel(modelId);
    return (inputTokens * caps.costInPerMTokUsd + outputTokens * caps.costOutPerMTokUsd) / TOKENS_PER_MILLION;
  }

  /** Admin: inserts or replaces an entry. Invalidates cache. */
  public async upsertModel(
    {model}: {model: IModelInfo},
  ): Promise<void> {
    await this.config.repository.save({model});
    this.cache = null;
  }

  /**
   * setEnabled -- switches a model off, or on again, without deleting it
   *
   * # About
   *
   * > A disabled model is refused by every call that names it; its entry, its profiles and its history stay.
   *
   * Saves the entry with the new flag and drops the cache, so the next call reads it. An unknown model is the 404 of
   * `getModel`. A call in flight on the model finishes and is reported (`estimateCostUsd` reads disabled entries too).
   *
   * # Who needs it
   *
   * The administration screen of the platform; a profile that names the model is not touched and fails at its next call.
   */
  public async setEnabled(
    {
      modelId,
      enabled,
    }: {
      /** Our model id. */
      modelId: string;
      /** New state. */
      enabled: boolean;
    },
  ): Promise<void> {
    const model = await this.findModel(modelId);
    await this.config.repository.save({
      model: {
        ...model,
        enabled,
      },
    });
    this.cache = null;
  }

  /**
   * removeModel -- deletes a model entry
   *
   * # About
   *
   * > Gone for good: prefer `setEnabled` to keep the entry and its history.
   *
   * An unknown model is the 404 of `getModel`. The registry is global and knows no profiles: a profile that names the
   * removed model is refused at its next call with the same 404, so switch the profiles first.
   */
  public async removeModel({modelId}: {modelId: string}): Promise<void> {
    await this.findModel(modelId);
    await this.config.repository.remove({modelId});
    this.cache = null;
  }

  /** Drops the cache and reloads from the repository. */
  public async refresh(): Promise<void> {
    this.cache = null;
    await this.getCatalog();
  }

  /** The catalog entry, enabled or not; throws if unknown. */
  private async findModel(modelId: string): Promise<IModelInfo> {
    const model = (await this.getCatalog()).get(modelId);
    if (!model) {
      throw dynaError({
        code: 5372567785992,
        status: 404,
        message: `ModelRegistry: unknown model [${modelId}]`,
        data: {modelId},
      });
    }
    return model;
  }

  /** The cached catalog, reloaded from the repository after cacheTtlMs. */
  private async getCatalog(): Promise<Map<string, IModelInfo>> {
    const ttlMs = this.config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (this.cache && Date.now() - this.cache.loadedAt < ttlMs) return this.cache.models;

    const models = await this.config.repository.loadAll();
    this.cache = {
      models: new Map(models.map(model => [model.id, model])),
      loadedAt: Date.now(),
    };
    return this.cache.models;
  }
}
