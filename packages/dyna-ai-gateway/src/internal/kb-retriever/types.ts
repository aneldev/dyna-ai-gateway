import {IEmbedder} from "../embedder";
import {
  IChunkFilters,
  IChunkHit,
  IVectorStore,
} from "../vector-store";
import {ILLMClientCallMeta} from "../llm-client";
import {IQueryRewriter} from "../query-rewriter";

/** Configuration of the KbRetriever. Lands in IAIGatewayConfig.kbRetriever. */
export interface IKbRetrieverConfig {
  /**
   * The most chunks a search returns (top-k).
   *
   * > Each chunk costs prompt tokens on every call; more chunks is not more grounding.
   *
   * @example 5 - a few chunks of a few hundred tokens: the default
   * @example 10 - short chunks (a low `maxTokens` of the chunker) or a model with a large window
   *
   * @default 5
   */
  k?: number;
  /**
   * The similarity below which a hit is dropped; an empty result after it is a `noMatch`.
   *
   * > Decides between a wrong chunk in the prompt and "not in the knowledge base".
   *
   * Measured for text-embedding-3-small with the eval set (the right chunk scores 0.64–0.85, the best chunk of an
   * off-topic question 0.54–0.57); another embedding model needs its own number.
   *
   * @example 0.6 - text-embedding-3-small
   *
   * @default 0.6
   */
  minScore?: number;
}

/** Shared instances KbRetriever needs; created once by AIGateway and passed as the second constructor argument. */
export interface IKbRetrieverDeps {
  /** Prompt → query, when switched on. */
  queryRewriter: IQueryRewriter;
  /** Query → vector (`embedOne`). */
  embedder: IEmbedder;
  /** Vector → nearest chunks (`search`). */
  vectorStore: IVectorStore;
}

/**
 * Prompt → grounded chunks.
 *
 * Implemented by `KbRetriever`; the type of `IAIGatewayDeps.kbRetriever`, so a host may pass its own in `overrides`.
 */
export interface IKbRetriever {
  /**
   * retrieve -- the chunks for one prompt
   *
   * # About
   *
   * > Rewrite, embed, search, cut.
   *
   * Rewrites the prompt into a query (when switched on), embeds it, searches the libraries and books of `filters` for
   * the tenant and keeps the hits of at least `minScore`, best first, at most `k`. With an empty `filters.libraryIds`
   * the knowledge base is not used: no model call, `searched` is false, `noMatch` is true. `k` and `minScore` override
   * the config for this call (the caller's `IGatewayAskInput.kbRetrieval`).
   *
   * # Who needs it
   *
   * `prepareCall`, once per call, after the input check and before the request is assembled.
   *
   * # Pitfalls
   *
   * Two model calls per search (rewrite, embed), each one usage-guard check and one trace. The search takes no abort
   * signal: `prepareCall` checks the signal before it, not during.
   */
  retrieve(
    {
      tenantId,
      prompt,
      facts,
      summary,
      cheapModelId,
      meta,
      filters,
      k,
      minScore,
    }: {
      tenantId: string;
      prompt: string;
      facts: Record<string, string>;
      summary: string;
      cheapModelId: string;
      /** Who asks, for the usage adapter and the trace; the kind is set here: QUERY_REWRITE for the rewrite, EMBED for the embedding. */
      meta: Omit<ILLMClientCallMeta, "kind">;
      /** The libraries and books to search. With an empty libraryIds nothing is searched: the result is noMatch, without a model call. */
      filters: IChunkFilters;
      /** Override config.k for this call. */
      k?: number;
      /** Override config.minScore for this call. */
      minScore?: number;
    },
  ): Promise<IRetrievalResult>;
}

/** What the Assembler receives from retrieval. */
export interface IRetrievalResult {
  /** The query actually embedded (after rewrite). */
  query: string;
  /** The chunks of at least `minScore`, best first, at most `k`; what the assembler injects and cites. */
  hits: IChunkHit[];
  /** True when nothing passed the threshold. */
  noMatch: boolean;
  /**
   * False when the call's scope names no library: the knowledge base was not used, and the prompt says nothing about it.
   * True with noMatch: the knowledge base was searched and has nothing — the prompt tells the model to say so.
   */
  searched: boolean;
}
