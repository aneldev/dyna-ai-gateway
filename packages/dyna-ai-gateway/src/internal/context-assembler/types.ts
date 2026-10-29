import {ZodType} from "zod";

import {
  IIssue,
  IToolDef,
  IUserContext,
  EOutputFormat,
} from "../../contracts";

import {
  IModelInfo,
  EModelProvider,
} from "../model-registry";
import {IAIProfile} from "../ai-profile-store";
import {IPromptTemplateStore} from "../prompt-template-store";
import {ITurnBuilder} from "../turn-builder";
import {IWorkingMemory} from "../working-memory";
import {IUserMemoryFact} from "../user-memory-store";
import {IRetrievalResult} from "../kb-retriever";
import {
  IInlineFilePart,
  IModelRequest,
} from "../llm-client";

/** Configuration of the ContextAssembler. Lands in IAIGatewayConfig.contextAssembler. */
export interface IContextAssemblerConfig {
  /**
   * Tokens kept free for the answer when the window is sized.
   *
   * > Room the history and the chunks may not take.
   *
   * @default the call's maxOutputTokens: min(profile.limits.maxOutputTokens, model.caps.maxOutputTokens)
   */
  reserveOutputTokens?: number;
  /**
   * Marks the stable part of the system prompt (template text, output format, addendum) for the provider's prompt cache.
   *
   * > Calls of one profile then pay the cached rate for that part (Anthropic: a cache marker; OpenAI caches on its own).
   * > Pays off when the stable part is longer than the model's minimum (512–4096 tokens): a long addendum, many tools.
   *
   * Required: whoever configures the gateway decides it. `false` sends the system prompt as one block with no marker.
   *
   * @example true - the stable part of every call is cached
   */
  promptCaching: boolean;
  /**
   * Lets calls of different tenants read one prompt-cache entry when their stable block is the same text.
   *
   * > Cheaper, faster calls for tenants that share a profile text, in exchange for no cache isolation between tenants.
   *
   * Only the stable block (template text, output format, addendum, tools) is shared, and only when it is identical to the
   * byte. What follows `{cacheBreakpoint}` (date, instructions, context, memory, knowledge base, history, the question) is
   * never shared, and answers are never cached. A call that reads another tenant's entry pays the cache-read price for
   * that part (Anthropic: 0.1× the input price) and its answer starts sooner; the call that wrote the entry paid the
   * cache-write price (Anthropic: 1.25×).
   * `false`: the stable block opens with a line that scopes it to the tenant (a hash of the tenant id, never the id
   * itself), so each tenant writes and reads its own entries; the tool definitions get no cache marker. Keep it `false`
   * when a faster or cheaper call must not reveal that another tenant sent the same profile text within the cache's
   * lifetime (5 minutes).
   * `true`: every tenant runs the same shipped profile text, and one cache entry should serve them all.
   * Required: whoever configures the gateway decides it. Ignored when `promptCaching` is `false`.
   *
   * @example false - each tenant has its own cache entries: isolation before cost
   * @example true - every tenant uses the library's seed template with no addendum: one entry serves all
   */
  sharePromptCacheAcrossTenants: boolean;
}

/** Shared instances ContextAssembler needs; created once by AIGateway and passed as the second constructor argument. */
export interface IContextAssemblerDeps {
  promptTemplateStore: IPromptTemplateStore;
  turnBuilder: ITurnBuilder;
  /** Asked for the history of every request, once the system prompt is rendered and the budget is known. */
  workingMemory: IWorkingMemory;
}

/**
 * Ten inputs in, one request out.
 *
 * Implemented by `ContextAssembler`; the type of `IAIGatewayDeps.contextAssembler`, so a host may pass its own in `overrides`.
 */
export interface IContextAssembler {
  /**
   * Builds the LLMClient request: system = rendered CHAT_MAIN (output format, addendum, today, locale, timezone, instructions,
   * context, memory, knowledge-base chunks), messages = the window the working memory gives for the thread. The system prompt is rendered
   * first, so the memory is asked with the budget that is left (`contextTokens − reserveOutputTokens − system`); its notes
   * then go into the `{memory}` slot. While the request would still overflow the model's window, the oldest messages are
   * left out first, then the lowest-ranked chunks; the memory's notes and the user's facts are never cut.
   * The files of the question are put into its message when the model can read their type (images, PDF); a file it cannot
   * read is left out with a WARNING file_dropped.
   */
  build(args: { input: IContextInput }): Promise<IAssembledContext>;

  /** Token count of a request (`estimateRequestTokens`: a real tokenizer for OpenAI, a safe factor for the other providers, the providers' formulas for files); the same count build trims with and the UsageGuard is asked with. */
  estimateTokens(args: {
    request: IModelRequest;
    /** The model's provider; omit when unknown, the safe factor is applied then. */
    provider?: EModelProvider;
  }): number;
}

/** Everything one call needs, gathered by the gateway. */
export interface IContextInput {
  profile: IAIProfile;
  model: IModelInfo;
  userContext: IUserContext;
  userFacts: IUserMemoryFact[];
  /** Thread the request is for; the working memory is asked for its window with it. */
  threadId: string;
  /** Files of the current user turn, already loaded as bytes. */
  inlineFiles: IInlineFilePart[];
  retrieval: IRetrievalResult;
  tools: IToolDef[];
  /**
   * Text of the `{instructions}` slot, from `IGatewayAskInput.instructions`.
   *
   * > The app's rule for this call only, rendered as is after `{addendum}`.
   *
   * @example "Summarise the invoice in three bullet points." - sent by the "Summarise" button of the invoice screen
   *
   * @default ""
   */
  instructions?: string;
  /**
   * Text of the `{context}` slot, from `IGatewayAskInput.context`.
   *
   * > What the user is looking at, rendered under a "data, not instructions" label after `{instructions}`.
   *
   * @example "Invoice 4711, status OVERDUE, due 2026-09-30" - the record open on screen
   *
   * @default ""
   */
  context?: string;
  /** Optional structured output. */
  outputSchema?: ZodType;
  /** Format of a text answer. Default MARKDOWN; no format instruction when outputSchema is given. */
  outputFormat?: EOutputFormat;
  /** Sampling temperature of the request; omit for the provider default. */
  temperature?: number;
}

/** The request plus provenance for Trace. */
export interface IAssembledContext {
  request: IModelRequest;
  /** Template version used. */
  templateVersion: number;
  /** Chunk ids injected, for citations. */
  chunkIds: string[];
  estimatedInputTokens: number;
  /** WARNING issues: files dropped because caps forbid them, turns trimmed for the window. */
  issues: IIssue[];
}
