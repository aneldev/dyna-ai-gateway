import {dynaError} from "dyna-error";

import {
  IModelCaps,
  IModelInfo,
  IModelRegistry,
  IModelRegistryConfig,
  EModelProvider,
} from "./types";

/** The catalog's cache TTL when the config names none. */
const DEFAULT_CACHE_TTL_MS = 60_000;
/** The prices of `IModelCaps` are per million tokens. */
const TOKENS_PER_MILLION = 1_000_000;
/** Anthropic's list price of a cache read, as a share of the input price. */
const ANTHROPIC_CACHE_READ_FACTOR = 0.1;
/** Anthropic's list price of a cache write (5-minute cache), as a share of the input price. */
const ANTHROPIC_CACHE_WRITE_FACTOR = 1.25;

/**
 * The in-memory copy of the catalog, with the time it was read.
 *
 * `ModelRegistry` only; dropped by every admin write and by `refresh`.
 */
interface ICatalogCache {
  /** Every entry of the repository, enabled or not, by id. */
  models: Map<string, IModelInfo>;
  /** When the repository was read (`Date.now()`); the cache is stale after `cacheTtlMs`. */
  loadedAt: number;
}

/**
 * ModelRegistry -- the global catalog of the models the platform may use
 *
 * # About
 *
 * > Facts about a model, never a tenant's choice.
 *
 * One place that answers "what can this model do and what does it cost": provider and provider id, capabilities, prices,
 * the enabled flag. No provider knowledge leaks into the rest of the gateway: the LLMClient reads `provider` and
 * `providerModelId`, the call path reads `caps`, the UsageGuard and the trace get `estimateCostUsd`.
 *
 * - Global by design, no `tenantId`: a tenant picks a model through its profile and never edits here.
 * - The read path is hot (every call reads `caps`), so the catalog is cached with a TTL; the write path is rare and drops
 *   the cache.
 * - A disabled model stays in the catalog: it is refused by every call that names it, and a call in flight is still priced.
 *
 * Created first by `createGatewayDeps`: the LLMClient, the AIProfileStore and the guardrails depend on it.
 *
 * # Who needs it
 *
 * `prepareCall` and `AIGateway.resume` (the profile's model), `AIProfileStore.upsertProfile` (validation), `LLMClient` (every
 * call), the guardrails' judge; the host's administration screen through `AIGateway.modelRegistry`.
 *
 * # What needs
 *
 * `IModelRegistryConfig`: the `IModelRegistryRepository` and the optional `cacheTtlMs`.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Any question about a model given its id; any admin write to the catalog.
 *
 * ## When shouldn't use it
 *
 * Which model a tenant uses: that is the profile (`AIProfileStore`). What a call may spend: that is the UsageGuard.
 *
 * # Pitfalls
 *
 * An admin write is visible to other instances only after their cache TTL. A disabled or removed model fails the profiles that
 * name it at their next call: switch the profiles first.
 */
export class ModelRegistry implements IModelRegistry {
  private cache: ICatalogCache | null = null;

  constructor(private readonly config: IModelRegistryConfig) {
  }

  /**
   * getModel -- one model entry, enabled
   *
   * # About
   *
   * > The facts of a model, for a call that is about to use it.
   *
   * Reads the cached catalog and returns a copy of the entry. An unknown id is a 404, a disabled one a 400: a call never
   * reaches a model the platform switched off.
   *
   * # Who needs it
   *
   * `prepareCall` (the profile's model, step 1), `AIProfileStore.upsertProfile` (the profile's models must exist and be
   * enabled), `LLMClient` (provider and provider id of every call), the guardrails' judge, `AIGateway.resume`.
   */
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

  /**
   * listModels -- the catalog, for an administration screen or a profile editor
   *
   * # About
   *
   * > Every model the platform knows, enabled ones by default, one provider on request.
   *
   * Read from the cache; copies, in the repository's order.
   *
   * # Who needs it
   *
   * The host's administration screen and profile editor; the dev sandbox.
   */
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

  /**
   * getCaps -- the capabilities and prices of a model, without the rest of the entry
   *
   * # About
   *
   * > `getModel(...).caps`, for a caller that holds only the id.
   *
   * The same 404 and 400 as `getModel`. No class of the gateway calls it today: `prepareCall` loads the model once and hands
   * its `caps` to the ToolPolicy and the ContextAssembler.
   *
   * # Who needs it
   *
   * A host that checks a model's capabilities before it builds a profile.
   */
  public async getCaps(
    {modelId}: {modelId: string},
  ): Promise<IModelCaps> {
    return (await this.getModel({modelId})).caps;
  }

  /**
   * estimateCostUsd -- the USD estimate of one call, from its token counts
   *
   * # About
   *
   * > uncached × costIn + cache reads × costCacheRead + cache writes × costCacheWrite + output × costOut, per million tokens.
   *
   * The uncached input is `inputTokens` minus the cached and the cache-write tokens, never below zero (a provider that reports
   * more cached tokens than the total yields no negative count). The cache rates are the caps' (`costCacheReadPerMTokUsd`,
   * `costCacheWritePerMTokUsd`) or their provider defaults: Anthropic 0.1 × and 1.25 × the input price, any other provider the
   * input price. Works for a disabled model too: a call that was in flight when the model got disabled is still reported.
   *
   * # Who needs it
   *
   * `LLMClient`, after every call, for the UsageGuard and the trace.
   */
  public async estimateCostUsd(
    {
      modelId,
      inputTokens,
      outputTokens,
      cachedInputTokens = 0,
      cacheWriteInputTokens = 0,
    }: {
      /** Our model id. */
      modelId: string;
      /** Prompt tokens, the cached ones included. */
      inputTokens: number;
      /** Completion tokens. */
      outputTokens: number;
      /** Of `inputTokens`, the ones read from the provider's cache. */
      cachedInputTokens?: number;
      /** Of `inputTokens`, the ones written to the provider's cache. */
      cacheWriteInputTokens?: number;
    },
  ): Promise<number> {
    const {
      provider,
      caps,
    } = await this.findModel(modelId);
    const isAnthropic = provider === EModelProvider.ANTHROPIC;
    const costCacheRead = caps.costCacheReadPerMTokUsd ?? (isAnthropic ? caps.costInPerMTokUsd * ANTHROPIC_CACHE_READ_FACTOR : caps.costInPerMTokUsd);
    const costCacheWrite = caps.costCacheWritePerMTokUsd ?? (isAnthropic ? caps.costInPerMTokUsd * ANTHROPIC_CACHE_WRITE_FACTOR : caps.costInPerMTokUsd);
    // A provider that reports more cached tokens than the total never yields a negative uncached count.
    const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheWriteInputTokens);
    return (
      uncachedInputTokens * caps.costInPerMTokUsd
      + cachedInputTokens * costCacheRead
      + cacheWriteInputTokens * costCacheWrite
      + outputTokens * caps.costOutPerMTokUsd
    ) / TOKENS_PER_MILLION;
  }

  /**
   * upsertModel -- inserts or replaces a model entry
   *
   * # About
   *
   * > The administration write: the entry as given, whole, and the cache dropped.
   *
   * Saves through the repository and drops this instance's cache, so the next read sees the entry; other instances see it
   * after their TTL. No validation of the entry beyond its type: the host's screen is the editor.
   *
   * # Who needs it
   *
   * The host's administration screen; the tests and the first run, to seed the catalog.
   */
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

  /**
   * refresh -- drops the cache and reloads the catalog from the repository
   *
   * # About
   *
   * > For a host that changed the repository behind the registry's back.
   *
   * The next reads are served from the reloaded catalog; nothing else changes.
   */
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
