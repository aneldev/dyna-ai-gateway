import {ZodType} from "zod";

import {
  IIssue,
  ISkill,
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
import {ISkillRegistry} from "../skill-registry";
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
   * > Calls of one profile then pay the cached rate for that part (Anthropic: a cache marker; OpenAI: a cache key, it caches the prefix on its own).
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
  /** Renders `CHAT_MAIN` with the slots, and is read for the `{cacheBreakpoint}` and `{skills}` checks. */
  promptTemplateStore: IPromptTemplateStore;
  /** Renders the `{skills}` slot from the call's skills (D124). */
  skillRegistry: ISkillRegistry;
  /** Not read by the assembler today: the messages come from the working memory (D122). */
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
   * build -- the model request of one call
   *
   * # About
   *
   * > System prompt first, then the history that fits, then the trim.
   *
   * Renders `CHAT_MAIN` (output format, addendum, skills, today, locale, timezone, instructions, context, memory,
   * knowledge-base chunks) and asks the working memory for the thread's window with the budget that is left
   * (`contextTokens − reserveOutputTokens − system`); its notes are rendered into `{memory}` after the user's facts. While
   * the request would still overflow the model's window, the oldest messages are left out first (`turns_trimmed`), then the
   * lowest-ranked chunks (`kb_chunks_trimmed`); the notes and the facts are never cut. The skills are listed by name and
   * description when `load_skill` is among the tools, written out otherwise; a stored `CHAT_MAIN` without `{skills}` drops
   * them with the WARNING `skills_slot_missing`. The files of the question go into its message when the model can read
   * their type (images, PDF); another file is left out with the WARNING `file_dropped`. Returns the request, the template
   * version, the chunk ids that are in it, the estimated input tokens and the warnings.
   *
   * # Who needs it
   *
   * `prepareCall`, for every `ask` and `run`.
   */
  build(args: { input: IContextInput }): Promise<IAssembledContext>;

  /**
   * estimateTokens -- the token count of a request
   *
   * # About
   *
   * > The same count `build` trims with and the `UsageGuard` is asked with.
   *
   * `estimateRequestTokens`: a real tokenizer for OpenAI, a safe factor for the other providers, the providers' formulas for
   * the files.
   *
   * # Who needs it
   *
   * `build`, for the trim and for `estimatedInputTokens`; a host that wants to size a request before it sends it.
   */
  estimateTokens(args: {
    request: IModelRequest;
    /** The model's provider; omit when unknown, the safe factor is applied then. */
    provider?: EModelProvider;
  }): number;
}

/** Everything one call needs, gathered by the gateway. */
export interface IContextInput {
  /** The profile of the call: its addendum, its output limit, its memory strategy. */
  profile: IAIProfile;
  /** The resolved model: its provider, its window and its caps decide the trim and the files. */
  model: IModelInfo;
  /** Who is asking: tenant, locale, timezone and "now" for the `{today}` slot. */
  userContext: IUserContext;
  /** What is known about the user, rendered into `{memory}` before the thread's notes. */
  userFacts: IUserMemoryFact[];
  /** Thread the request is for; the working memory is asked for its window with it. */
  threadId: string;
  /** Files of the current user turn, already loaded as bytes. */
  inlineFiles: IInlineFilePart[];
  /** The knowledge-base search of the call: whether it ran and what it found, for the `{kb}` slot. */
  retrieval: IRetrievalResult;
  /** The tools of the call; read only to see whether `load_skill` is offered (the skills are then listed, not inlined). */
  tools: IToolDef[];
  /**
   * The skills of the call, for the `{skills}` slot (D124).
   *
   * > The resolved list: the profile's skills, then the call's (`SkillRegistry.resolve`).
   *
   * Listed by name and description when `tools` holds `load_skill`, written out in full otherwise.
   *
   * @default [] - no skills, the slot renders to nothing
   */
  skills?: ISkill[];
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
  /** The request the LLMClient sends. */
  request: IModelRequest;
  /** Template version used. */
  templateVersion: number;
  /** Chunk ids injected, for citations. */
  chunkIds: string[];
  /** `estimateTokens` of the request as built; the files' tokens included. */
  estimatedInputTokens: number;
  /** WARNING issues: files dropped because caps forbid them, turns trimmed for the window. */
  issues: IIssue[];
}
