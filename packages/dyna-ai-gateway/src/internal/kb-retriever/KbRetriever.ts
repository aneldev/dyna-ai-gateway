import {
  devConsole,
  EDevConsole,
} from "../../dev-sandbox/utils/devConsole";

import {IChunkFilters} from "../vector-store";
import {ILLMClientCallMeta} from "../llm-client";
import {ETraceKind} from "../trace";

import {
  IKbRetriever,
  IKbRetrieverConfig,
  IKbRetrieverDeps,
  IRetrievalResult,
} from "./types";

const DEFAULT_K = 5;
/**
 * Measured with the eval of tests/internal/eval on text-embedding-3-small (score = (1 + cosine) / 2): the right chunk scores 0.64–0.85,
 * the best chunk of an off-topic question 0.54–0.57. Another embedding model has other numbers: set config.minScore for it.
 */
const DEFAULT_MIN_SCORE = 0.6;

/**
 * KbRetriever -- the read side of the knowledge base: prompt to grounded chunks
 *
 * # About
 *
 * > Finds what the model should read, or says plainly that there is nothing.
 *
 * Implements `IKbRetriever`: rewrite the prompt into a query (`QueryRewriter`, when switched on) → embed it
 * (`Embedder.embedOne`) → search the tenant's index inside the scope the caller named (`VectorStore.search`) → keep
 * the hits of at least `minScore`, best first, at most `k`. `noMatch` is a first-class result: the prompt then tells
 * the model the knowledge base has nothing. `searched` tells that apart from a call that named no library and did not
 * use the knowledge base at all (D25, D26).
 *
 * It sets the quality ceiling of grounded answers whatever the main model is: a chunk it misses is never read.
 *
 * # Who needs it
 *
 * `prepareCall`, once per `ask` / `run` call, with `IGatewayInput.kbFilters` as the scope; the result goes to the
 * `ContextAssembler`. A host replaces it with its own `IKbRetriever` (a reranker, hybrid search) in
 * `overrides.kbRetriever`.
 *
 * # What needs
 *
 * `queryRewriter`, `embedder`, `vectorStore`.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, through the gateway: `createGatewayDeps` creates it from `IAIGatewayConfig.kbRetriever` (optional, all
 * defaults).
 *
 * ## When shouldn't use it
 *
 * A call that should not touch the knowledge base passes an empty `libraryIds`: no rewrite, no embedding, no search.
 *
 * # Pitfalls
 *
 * `minScore` is tied to the embedding model: change the model and the default drops the right chunks or lets the wrong
 * ones through. The retriever has no reranker and no keyword search: a question whose words are not in the chunk and not
 * in its heading path is missed.
 */
export class KbRetriever implements IKbRetriever {
  constructor(
    private readonly config: IKbRetrieverConfig,
    private readonly deps: IKbRetrieverDeps,
  ) {}

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
   * the config for this call.
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
  public async retrieve(
    {
      tenantId,
      prompt,
      facts,
      summary,
      cheapModelId,
      meta,
      filters,
      k = this.config.k ?? DEFAULT_K,
      minScore = this.config.minScore ?? DEFAULT_MIN_SCORE,
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
  ): Promise<IRetrievalResult> {
    if (filters.libraryIds !== "all" && !filters.libraryIds.length) {
      devConsole.log(EDevConsole.KB_RETRIEVER, "skip", "no libraryIds, knowledge base not searched");
      return {
        query: prompt,
        hits: [],
        noMatch: true,
        searched: false,
      };
    }

    const query = await this.deps.queryRewriter.rewrite({
      prompt,
      facts,
      summary,
      cheapModelId,
      meta: {
        ...meta,
        kind: ETraceKind.QUERY_REWRITE,
      },
    });
    devConsole.log(EDevConsole.KB_RETRIEVER, "query", {
      prompt,
      query,
    });
    const vector = await this.deps.embedder.embedOne({
      text: query,
      meta: {
        ...meta,
        kind: ETraceKind.EMBED,
      },
    });
    const allHits = await this.deps.vectorStore.search({
      tenantId,
      vector,
      k,
      filters,
    });
    const hits = allHits.filter(hit => hit.score >= minScore);
    devConsole.log(
      EDevConsole.KB_RETRIEVER,
      "hits",
      {
        k,
        minScore,
        filters,
        found: allHits,
        kept: hits,
      },
      allHits.map(hit => ({
        score: hit.score,
        kept: hit.score >= minScore,
        chunkId: hit.chunk.id,
        text: hit.chunk.text.slice(0, 80),
      })),
    );

    return {
      query,
      hits,
      noMatch: !hits.length,
      searched: true,
    };
  }
}
