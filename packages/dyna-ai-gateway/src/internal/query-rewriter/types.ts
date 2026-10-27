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
  llmClient: ILLMClient;
  promptTemplateStore: IPromptTemplateStore;
}

/**
 * Prompt + thread facts → one search query.
 *
 * Implemented by `QueryRewriter`; the type of `IAIGatewayDeps.queryRewriter`, so a host may pass its own in `overrides`.
 */
export interface IQueryRewriter {
  /**
   * Returns the query to embed: one standalone line the cheap model makes of the prompt and the thread's memory.
   * Returns the prompt itself, without a model call, when the rewriting is switched off or the thread has no memory yet
   * (nothing to resolve "it" with); and when the model call fails or answers with nothing.
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
