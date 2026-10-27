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

/** Prompt + thread facts → one search query. */
export class QueryRewriter implements IQueryRewriter {
  constructor(
    private readonly config: IQueryRewriterConfig,
    private readonly deps: IQueryRewriterDeps,
  ) {}

  /**
   * Returns the query to embed: one standalone line the cheap model makes of the prompt and the thread's memory.
   * Returns the prompt itself, without a model call, when the rewriting is switched off or the thread has no memory yet
   * (nothing to resolve "it" with); and when the model call fails or answers with nothing.
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
          system: rendered.text,
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

  /** One line, without the quotes a model likes to put around it, not longer than a query should be. */
  private clean(text: string): string {
    return text
      .trim()
      .split("\n")[0]
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim()
      .slice(0, MAX_QUERY_CHARS);
  }
}
