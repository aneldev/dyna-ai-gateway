/** Configuration of the ModelRegistry. Lands in IAIGatewayConfig.modelRegistry. */
export interface IModelRegistryConfig {
  /** Persistence of the model entries: the host's adapter (in memory for the tests and the first run, a database in production). */
  repository: IModelRegistryRepository;
  /**
   * How long the catalog stays cached in memory, in milliseconds.
   *
   * > Every call reads `caps`; the repository is read once per TTL, not once per call.
   *
   * An admin write on this instance drops the cache at once; another instance sees it after its TTL.
   *
   * @example 5_000 - an admin screen that wants its own edits visible fast on every instance
   *
   * @default 60_000
   */
  cacheTtlMs?: number;
}

/**
 * Global catalog of usable models: facts, not tenant choices. Global by design; no tenantId.
 *
 * Implemented by `ModelRegistry`; the type of `IAIGatewayDeps.modelRegistry`, so a host may pass its own in `overrides`.
 */
export interface IModelRegistry {
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
  getModel(args: {modelId: string}): Promise<IModelInfo>;

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
  listModels(args?: {
    /** Skip disabled entries. Default true. */
    enabledOnly?: boolean;
    /** Filter by provider. */
    provider?: EModelProvider;
  }): Promise<IModelInfo[]>;

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
  getCaps(args: {modelId: string}): Promise<IModelCaps>;

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
  estimateCostUsd(args: {
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
  }): Promise<number>;

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
  upsertModel(args: {model: IModelInfo}): Promise<void>;

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
  setEnabled(args: {
    /** Our model id. */
    modelId: string;
    /** New state. */
    enabled: boolean;
  }): Promise<void>;

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
  removeModel(args: {modelId: string}): Promise<void>;

  /**
   * refresh -- drops the cache and reloads the catalog from the repository
   *
   * # About
   *
   * > For a host that changed the repository behind the registry's back.
   *
   * The next reads are served from the reloaded catalog; nothing else changes.
   */
  refresh(): Promise<void>;
}

/** Persistence seam of the registry. Implement once per storage engine. Only the registry calls it. */
export interface IModelRegistryRepository {
  /**
   * loadAll -- every model entry
   *
   * # About
   *
   * > The whole catalog, for the registry's cache.
   *
   * Returns every stored entry, in any order.
   *
   * # Who needs it
   *
   * `ModelRegistry.getCatalog`, on a refresh.
   */
  loadAll(): Promise<IModelInfo[]>;
  /**
   * save -- inserts or replaces one entry
   *
   * # About
   *
   * > Upsert by `model.id`.
   *
   * The entry is stored whole; an entry with the same id is replaced.
   *
   * # Who needs it
   *
   * `ModelRegistry.upsertModel` and `setEnabled`.
   */
  save(args: {model: IModelInfo}): Promise<void>;
  /**
   * remove -- deletes one entry
   *
   * # About
   *
   * > Permanent; nothing when it does not exist.
   *
   * Removes the entry with this id.
   *
   * # Who needs it
   *
   * `ModelRegistry.removeModel`.
   */
  remove(args: {modelId: string}): Promise<void>;
}

/** One model entry. Use wherever a model is referenced by id and its facts are needed. */
export interface IModelInfo {
  /** Our stable id, e.g. "gpt-5-mini". Referenced by AIProfile. */
  id: string;
  /** Which SDK provider the LLMClient must use. */
  provider: EModelProvider;
  /** The provider's own id, e.g. "gpt-5-mini-2026-06". */
  providerModelId: string;
  /** Human label for admin UI. */
  label: string;
  /** What the model can receive and produce. */
  caps: IModelCaps;
  /** Disabled entries are not selectable and not usable. */
  enabled: boolean;
  /** Set when the provider announces retirement. */
  deprecatedAt: Date | null;
}

/** Capabilities and cost of a model. Checked before building a request. */
export interface IModelCaps {
  /** Can call tools. */
  tools: boolean;
  /** Accepts image parts. */
  images: boolean;
  /** Accepts PDF parts. */
  pdf: boolean;
  /** Supports schema-constrained JSON output. */
  structuredOutput: boolean;
  /** Exposes reasoning control. */
  reasoning: boolean;
  /**
   * Accepts a sampling temperature.
   *
   * > Decides whether a call may carry `temperature`; the gateway refuses one on a model without this cap (400) instead of
   * > letting the provider drop it with a warning.
   *
   * False for the OpenAI reasoning models (o-series, GPT-5 family): they reject the parameter. True for the Anthropic models.
   */
  temperature: boolean;
  /** True only for embedding models. */
  embeddings: boolean;
  /** Context window in tokens. */
  contextTokens: number;
  /** Max output tokens per call. */
  maxOutputTokens: number;
  /** USD per 1M input tokens. */
  costInPerMTokUsd: number;
  /** USD per 1M output tokens. */
  costOutPerMTokUsd: number;
  /**
   * USD per 1M input tokens read from the provider's prompt cache.
   *
   * > Prices the `cachedInputTokens` of a call.
   *
   * @example 0.1 - claude-haiku-4-5 (0.1 × its 1.00 input price)
   *
   * @default Anthropic: 0.1 × costInPerMTokUsd; any other provider: costInPerMTokUsd (the rate differs per OpenAI model: set it)
   */
  costCacheReadPerMTokUsd?: number;
  /**
   * USD per 1M input tokens written to the provider's prompt cache.
   *
   * > Prices the `cacheWriteInputTokens` of a call.
   *
   * @example 1.25 - claude-haiku-4-5, 5-minute cache (1.25 × its 1.00 input price)
   *
   * @default Anthropic: 1.25 × costInPerMTokUsd; any other provider: costInPerMTokUsd (OpenAI bills no write)
   */
  costCacheWritePerMTokUsd?: number;
}

/** Providers the LLMClient has an adapter for. Add a value when the LLMClient supports a new one. */
export enum EModelProvider {
  /** OpenAI: the GPT and o-series models under OpenAI's own ids. */
  OPENAI = "OPENAI",
  /** Anthropic: the Claude models under Anthropic's own ids; the only provider with cache-read and cache-write prices by default. */
  ANTHROPIC = "ANTHROPIC",
  /** Google: the Gemini models under Google's own ids. */
  GOOGLE = "GOOGLE",
  /** Mistral: the Mistral models under Mistral's own ids. */
  MISTRAL = "MISTRAL",
  /** Amazon Bedrock: the AWS-hosted models (Anthropic, Amazon, Meta, Mistral, …) under Bedrock's own model ids. */
  BEDROCK = "BEDROCK",
}
