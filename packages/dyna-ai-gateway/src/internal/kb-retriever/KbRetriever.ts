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

/** Prompt → grounded chunks. */
export class KbRetriever implements IKbRetriever {
  constructor(
    private readonly config: IKbRetrieverConfig,
    private readonly deps: IKbRetrieverDeps,
  ) {}

  /**
   * Retrieves the chunks for one prompt, tenant-filtered: rewrite the prompt into a query (when switched on) → embed it →
   * search the libraries and books of `filters` → keep the hits of at least minScore, best first, at most k.
   * With an empty filters.libraryIds the knowledge base is not used: no model call, `searched` is false.
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
