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
  /** Max chunks returned. Default 5. */
  k?: number;
  /** Hits below are dropped. Default 0.6, measured for text-embedding-3-small with the eval set; another embedding model needs its own number. */
  minScore?: number;
}

/** Shared instances KbRetriever needs; created once by AIGateway and passed as the second constructor argument. */
export interface IKbRetrieverDeps {
  queryRewriter: IQueryRewriter;
  embedder: IEmbedder;
  vectorStore: IVectorStore;
}

/**
 * Prompt → grounded chunks.
 *
 * Implemented by `KbRetriever`; the type of `IAIGatewayDeps.kbRetriever`, so a host may pass its own in `overrides`.
 */
export interface IKbRetriever {
  /**
   * Retrieves the chunks for one prompt, tenant-filtered: rewrite the prompt into a query (when switched on) → embed it →
   * search the libraries and books of `filters` → keep the hits of at least minScore, best first, at most k.
   * With an empty filters.libraryIds the knowledge base is not used: no model call, `searched` is false.
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
  hits: IChunkHit[];
  /** True when nothing passed the threshold. */
  noMatch: boolean;
  /**
   * False when the call's scope names no library: the knowledge base was not used, and the prompt says nothing about it.
   * True with noMatch: the knowledge base was searched and has nothing — the prompt tells the model to say so.
   */
  searched: boolean;
}
