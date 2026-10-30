/** Configuration of the ModelRegistry. Lands in IAIGatewayConfig.modelRegistry. */
export interface IModelRegistryConfig {
  /** Persistence of model entries; Mongo implementation in v1. */
  repository: IModelRegistryRepository;
  /** How long entries stay cached in memory. Default 60_000. */
  cacheTtlMs?: number;
}

/**
 * Global catalog of usable models: facts, not tenant choices. Global by design; no tenantId.
 *
 * Implemented by `ModelRegistry`; the type of `IAIGatewayDeps.modelRegistry`, so a host may pass its own in `overrides`.
 */
export interface IModelRegistry {
  /** Resolves one model; throws if unknown or disabled. Cached. */
  getModel(args: {modelId: string}): Promise<IModelInfo>;

  /** Lists models for admin UI or profile editors. Cached. */
  listModels(args?: {
    /** Skip disabled entries. Default true. */
    enabledOnly?: boolean;
    /** Filter by provider. */
    provider?: EModelProvider;
  }): Promise<IModelInfo[]>;

  /** Shortcut for callers that only need capabilities (Assembler, ToolPolicy). */
  getCaps(args: {modelId: string}): Promise<IModelCaps>;

  /**
   * USD estimate for a call; the LLMClient reports it to the UsageGuard and the trace after every call.
   * Works for a disabled model too: a call that was in flight when the model got disabled is still reported.
   * The cached tokens are priced at the model's cache rates (`costCacheReadPerMTokUsd`, `costCacheWritePerMTokUsd`, or
   * their provider defaults), the rest of the prompt at the input price.
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

  /** Admin: inserts or replaces an entry. Invalidates cache. */
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

  /** Drops the cache and reloads from the repository. */
  refresh(): Promise<void>;
}

/** Persistence seam of the registry. Implement once per storage engine. Only the registry calls it. */
export interface IModelRegistryRepository {
  /** Loads every entry; called on refresh. */
  loadAll(): Promise<IModelInfo[]>;
  /** Inserts or replaces one entry. */
  save(args: {model: IModelInfo}): Promise<void>;
  /** Deletes one entry permanently. */
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
  OPENAI = "OPENAI",
  ANTHROPIC = "ANTHROPIC",
  GOOGLE = "GOOGLE",
  MISTRAL = "MISTRAL",
  /** Amazon Bedrock: the AWS-hosted models (Anthropic, Amazon, Meta, Mistral, …) under Bedrock's own model ids. */
  BEDROCK = "BEDROCK",
}
