import {EPartKind} from "../../contracts";

import {
  ILLMClientCallMeta,
  EMessageRole,
} from "../llm-client";
import {EPromptTemplateKey} from "../prompt-template-store";

import {
  IQueryRewriter,
  IQueryRewriterConfig,
  IQueryRewriterDeps,
} from "./types";

/** A query is one line, but a reasoning model spends output tokens on thinking before it writes: with a small limit it returns nothing. */
const MAX_OUTPUT_TOKENS = 1_000;
const MAX_QUERY_CHARS = 500;
const NOTHING = "(nothing yet)";

/**
 * QueryRewriter -- turns the user's message into a standalone search query
 *
 * # About
 *
 * > "Can I still do it for last year's?" searches badly; "refund paid invoice time limit" searches well.
 *
 * Implements `IQueryRewriter`: one cheap-model call before the retrieval that resolves "it", "that one", "the same"
 * with the thread's summary and facts (the `WorkingMemory` state) and returns one line to embed. The KB_QUERY_REWRITE
 * template forbids answering the question. Nothing is stored.
 *
 * Behind a required switch (`enabled`, D24): off, the prompt is embedded as it is and no model is called. On, the model
 * is still skipped when the thread has no memory yet (nothing to resolve a pronoun with).
 *
 * It is the first step of `KbRetriever.retrieve`, before the `Embedder` and the `VectorStore`.
 *
 * # Who needs it
 *
 * `KbRetriever.retrieve`, once per call with a knowledge-base scope. A host replaces it with its own `IQueryRewriter`
 * (HyDE, multi-query) in `overrides.queryRewriter`.
 *
 * # What needs
 *
 * `llmClient` for the call, `promptTemplateStore` for the template.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, through the gateway: `createGatewayDeps` creates it from `IAIGatewayConfig.queryRewriter`.
 *
 * ## When shouldn't use it
 *
 * Switch it off (`enabled: false`) while threads are short or the knowledge base is small: the raw prompt searches
 * well enough and the call is saved.
 *
 * # Pitfalls
 *
 * One more model call and its latency before every search, on the thread's cheap model. A failed call or an empty
 * answer falls back to the prompt (error 5372778284115 in the log), never to no search.
 */
export class QueryRewriter implements IQueryRewriter {
  constructor(
    private readonly config: IQueryRewriterConfig,
    private readonly deps: IQueryRewriterDeps,
  ) {}

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
  public async rewrite(
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
  ): Promise<string> {
    const factLines = Object.entries(facts).map(([key, value]) => `${key}: ${value}`);
    if (!this.config.enabled || (!summary && !factLines.length)) return prompt;

    const rendered = await this.deps.promptTemplateStore.render({
      key: EPromptTemplateKey.KB_QUERY_REWRITE,
      slots: {
        summary: summary || NOTHING,
        facts: factLines.join("\n") || NOTHING,
      },
    });
    try {
      const result = await this.deps.llmClient.complete({
        request: {
          modelId: cheapModelId,
          system: [{text: rendered.text}],
          messages: [
            {
              role: EMessageRole.USER,
              parts: [
                {
                  kind: EPartKind.TEXT,
                  text: prompt,
                },
              ],
            },
          ],
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
        meta,
      });
      return this.clean(result.text) || prompt;
    }
    catch (error) {
      console.error("Internal error 5372778284115: QueryRewriter: the query was not rewritten, the prompt is searched as it is", error);
      return prompt;
    }
  }

  /** The first line, unquoted, cut at MAX_QUERY_CHARS. */
  private clean(text: string): string {
    return text
      .trim()
      .split("\n")[0]
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim()
      .slice(0, MAX_QUERY_CHARS);
  }
}
