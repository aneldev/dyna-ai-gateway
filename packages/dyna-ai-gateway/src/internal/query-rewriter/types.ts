import {IPromptTemplateStore} from "../prompt-template-store";
import {
  ILLMClient,
  ILLMClientCallMeta,
} from "../llm-client";

/** Configuration of the QueryRewriter. Lands in IAIGatewayConfig.queryRewriter. */
export interface IQueryRewriterConfig {
  /** The switch of the rewriting. Off: the prompt is searched as it is, the model is never called for it. No default: it is decided where the gateway is configured. */
  enabled: boolean;
}

/** Shared instances QueryRewriter needs; created once by AIGateway and passed as the second constructor argument. */
export interface IQueryRewriterDeps {
  /** The cheap-model call. */
  llmClient: ILLMClient;
  /** Renders the KB_QUERY_REWRITE template. */
  promptTemplateStore: IPromptTemplateStore;
}

/**
 * Prompt + thread facts → one search query.
 *
 * Implemented by `QueryRewriter`; the type of `IAIGatewayDeps.queryRewriter`, so a host may pass its own in `overrides`.
 */
export interface IQueryRewriter {
  /**
   * rewrite -- the query to embed for one prompt
   *
   * # About
   *
   * > One standalone line, or the prompt itself.
   *
   * Renders the KB_QUERY_REWRITE template with the thread's summary and facts (or "(nothing yet)"), sends the prompt
   * as the user message to the cheap model and returns the first line of the answer, unquoted, cut at 500 characters.
   * Returns the prompt itself, without a model call, when the rewriting is switched off or the thread has no memory yet;
   * and when the model call fails or answers with nothing.
   *
   * # Who needs it
   *
   * `KbRetriever.retrieve`, before it embeds.
   *
   * # Pitfalls
   *
   * The output limit is 1000 tokens although a query is one line: a reasoning model spends tokens on thinking first,
   * and with a small limit returns nothing.
   */
  rewrite(
    {
      prompt,
      facts,
      summary,
      cheapModelId,
      meta,
    }: {
      prompt: string;
      /** From WorkingMemory; resolves "it", "that one". */
      facts: Record<string, string>;
      summary: string;
      cheapModelId: string;
      /** For the usage adapter and the trace; kind = QUERY_REWRITE. */
      meta: ILLMClientCallMeta;
    },
  ): Promise<string>;
}
