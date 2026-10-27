import {IIssue} from "../../contracts";

import {IModelInfo} from "../model-registry";
import {IAIProfile} from "../ai-profile-store";
import {IPromptTemplateStore} from "../prompt-template-store";
import {IThreadStore} from "../thread-store";
import {ITurnBuilder} from "../turn-builder";
import {
  ILLMClient,
  ILLMClientCallMeta,
  IMessage,
  IModelRequest,
  IModelResult,
} from "../llm-client";

/**
 * The thread memory of the gateway, raw: what the model gets from the thread's history, and what it learns from an answer.
 *
 * Implemented by `WorkingMemory` (two built-in strategies, `EWorkingMemoryStrategy`) and by a host class passed as
 * `overrides.workingMemory` to the `AIGateway` constructor. The gateway holds no history logic of its own: the
 * `ContextAssembler` calls `load` for every request, the background memory update calls `saveContext` after every
 * answer, the facade calls `getState` and `reset` for the UI.
 */
export interface IWorkingMemory {
  /**
   * load -- the history part of one model request
   *
   * # About
   *
   * > Everything the model should know from this thread, sized for this call.
   *
   * Returns the message window (the turns the model reads verbatim, the current user turn last) and the notes (the text
   * of the "About this conversation" part of the `{memory}` slot; empty when there is nothing). Which turns, how many
   * and whether there are notes is the implementation's business: the strategy, the profile's override, the budget.
   *
   * - Never calls a model.
   * - Never writes.
   *
   * # Who needs it
   *
   * `ContextAssembler.build`, once per request, after it rendered the system prompt, so `budgetTokens` is known.
   *
   * # Pitfalls
   *
   * `budgetTokens` is what is left of the window after the system prompt and the output reserve; an implementation
   * that returns more is trimmed by the assembler, oldest message first, with a `turns_trimmed` warning.
   */
  load(args: {
    tenantId: string;
    threadId: string;
    /** The call's profile; `profile.workingMemory` may override the gateway's strategy. */
    profile: IAIProfile;
    model: IModelInfo;
    /** Tokens left for the history after the system prompt and the output reserve. */
    budgetTokens: number;
  }): Promise<IWorkingMemoryLoad>;

  /**
   * saveContext -- learns from one answered call
   *
   * # About
   *
   * > The answer is in; remember what must be remembered.
   *
   * Called in the background after every answer. The new turns are already stored on the thread (`ThreadStore`); an
   * implementation reads them from there, or from `request` and `result` when the gateway has them (an answer a human
   * edited in a review has no model result). The built-in `SUMMARY_BUFFER` updates the summary + facts when
   * `updateEveryTurns` turns are due; `SLIDING_WINDOW` does nothing.
   *
   * # Who needs it
   *
   * The gateway's background memory update, after `ask` and after every closed run.
   *
   * # Pitfalls
   *
   * Runs on the gateway's background queue (`whenIdle`): it must not throw; it reports and returns.
   */
  saveContext(args: {
    tenantId: string;
    userId: string;
    threadId: string;
    profile: IAIProfile;
    /** The request the answer was produced for; absent when the gateway has none at hand. */
    request?: IModelRequest;
    /** The model's answer; absent when a human wrote or edited it (a reviewed run). */
    result?: IModelResult;
    /** Cheap model for helper calls, resolved by the gateway (the profile's or the platform default). */
    cheapModelId: string;
    /** For the usage guard and the trace; `kind` = MEMORY_WORKING. */
    meta: ILLMClientCallMeta;
  }): Promise<void>;

  /**
   * getState -- what the memory has stored about one thread
   *
   * # About
   *
   * > The memory, as the user may see it.
   *
   * Returns the stored summary, facts and the turn count they were written at; the empty state for a thread the memory never
   * wrote. Under `SLIDING_WINDOW` the state is whatever an earlier `SUMMARY_BUFFER` period left: the window ignores it, it is
   * not wiped.
   *
   * - Never calls a model.
   * - Never writes.
   *
   * # Who needs it
   *
   * `AIGateway.getThreadMemory`, for a "what do you remember" UI.
   *
   * # Pitfalls
   *
   * An unknown thread, or one of another tenant, is a 404.
   */
  getState(args: {
    tenantId: string;
    threadId: string;
  }): Promise<IWorkingMemoryState>;

  /**
   * reset -- forgets what the memory stored about one thread
   *
   * # About
   *
   * > "Forget this conversation": the notes go, the turns stay.
   *
   * Clears the stored summary and facts and marks the turns so far as seen, so the next `saveContext` does not bring them
   * back. The thread and its turns are untouched; the model still reads the window.
   *
   * # Who needs it
   *
   * `AIGateway.resetThreadMemory`, for a "forget" action of the UI.
   *
   * # Pitfalls
   *
   * An unknown thread, or one of another tenant, is a 404.
   */
  reset(args: {
    tenantId: string;
    threadId: string;
  }): Promise<void>;
}

/**
 * What `IWorkingMemory.load` hands to the ContextAssembler.
 *
 * The assembler places `messages` as the request's messages and `notes` in the `{memory}` slot after the user facts.
 */
export interface IWorkingMemoryLoad {
  /** The turns the model reads verbatim, oldest first, the current user turn last. Never empty: at least the user turn. */
  messages: IMessage[];
  /** The "About this conversation" text: summary and facts under SUMMARY_BUFFER; "" under SLIDING_WINDOW or when nothing is known. */
  notes: string;
  /** WARNINGs about what was left out (`turns_trimmed`); the assembler adds them to the call's issues. */
  issues: IIssue[];
}

/**
 * The ways a thread's history reaches the model.
 *
 * `IWorkingMemoryConfig.strategy` names the gateway's default, `IAIProfile.workingMemory` overrides it per profile;
 * `WorkingMemory` resolves the two for every call.
 */
export enum EWorkingMemoryStrategy {
  /**
   * The latest turns verbatim, no summary, no helper model call.
   *
   * > What ChatGPT and Claude do: the model reads the conversation itself, not a digest of it.
   *
   * Pros:
   * - Precise: the model sees the exact words, numbers and code of the last turns, nothing is paraphrased away.
   * - No helper call: no cheap-model cost, no background job, no summary that can be wrong.
   * - Lowest latency to a correct memory: a fact stated one turn ago is there, not waiting for an update.
   * - Nothing stored: no thread state to maintain, reset or leak.
   *
   * Cons:
   * - The input tokens grow with the thread until the window is full; every call pays for the whole tail.
   * - Hard forgetting: a turn that falls off the window is gone for the model, with nothing standing in for it.
   * - Long threads crowd the knowledge base: `chatHistoryRatio` is the only brake.
   * - `getThreadMemory` has nothing to show the user; the query rewriter gets no thread context.
   *
   * Use it when:
   * - the exact wording matters: coding help, contract or document review, quoting the user back;
   * - threads are short-lived: a widget that answers a few questions, a form assistant;
   * - the model has a large window and the per-call cost is not the concern;
   * - no "what do you remember" UI is wanted.
   *
   * Do not use it when:
   * - threads run for days or hundreds of turns: every call pays for the tail, and what falls off is lost for good;
   * - the knowledge base must dominate the prompt (RAG assistants): the history competes with the chunks;
   * - a small-window or expensive model is used;
   * - the product shows or resets the thread memory.
   */
  SLIDING_WINDOW = "SLIDING_WINDOW",
  /**
   * A rolling summary + facts written by the cheap model, followed by the last `recentTurns` turns verbatim.
   *
   * > Long threads stay cheap: everything older than the tail is one short digest.
   *
   * Pros:
   * - Bounded input: the summary is capped, the tail is fixed, so a 500-turn thread costs like a 20-turn one.
   * - Soft forgetting: what left the tail lives on in the summary and the facts.
   * - Visible memory: `getThreadMemory` shows the user what the gateway remembers; `resetThreadMemory` clears it.
   * - The facts feed the knowledge-base rewriter (`QueryRewriter`) with the thread's context.
   *
   * Cons:
   * - A helper call after every `updateEveryTurns` turns: cheap-model cost and a background job per answer.
   * - Lossy: the digest drops wording and detail, and a wrong summary misleads every later call.
   * - Stale by one update: the summary runs in the background, so the digest lags the newest turns.
   * - Short threads pay for a summary they never needed.
   *
   * Use it when:
   * - threads are long-lived: support cases, personal assistants, agents that run for many steps;
   * - the cost per call must stay flat whatever the thread length;
   * - the product shows the thread memory to the user or lets him reset it;
   * - the knowledge-base rewriter should know the thread's context (the facts feed it).
   *
   * Do not use it when:
   * - the model must see the exact words of earlier turns: a paraphrase is a bug there;
   * - threads are a handful of turns: the helper call is pure overhead;
   * - a fact stated one turn ago must be available at once: the summary lags one background update;
   * - no cheap model is configured or budgeted for the helper calls.
   */
  SUMMARY_BUFFER = "SUMMARY_BUFFER",
}

/**
 * The thread's recent turns are sent verbatim, sized by the model's context window; no summary, no helper model call.
 *
 * Precise, and the cost grows with the length of the thread. Pick it for short or precision-critical threads; pick
 * `IWorkingMemorySummaryBuffer` for long threads where the token bill matters more than the exact wording of old turns.
 * Read by `WorkingMemory.load`.
 */
export interface IWorkingMemorySlidingWindow {
  type: EWorkingMemoryStrategy.SLIDING_WINDOW;
  /**
   * Share of the history budget the turns may fill.
   *
   * > Bounds the history so it cannot starve the knowledge-base chunks and the answer.
   *
   * The budget is the model's window minus the system prompt and the output reserve. The turns are taken newest first
   * while they fit the share, at least one; the knowledge-base chunks (capped by their own `topK`) take the rest.
   *
   * @example 0.8 - a chat assistant: the conversation is the point, the knowledge base is a side dish
   * @example 0.5 - a RAG assistant: half the room stays for the retrieved chunks
   *
   * @default 0.8
   */
  chatHistoryRatio?: number;
  /**
   * The most turns one `load` reads from the store before the token budget cuts them.
   *
   * > One read, no second round trip: the store pages by count, the budget is in tokens.
   *
   * Raise it for a very large window with many one-line turns; lower it to cap the read on a slow store.
   *
   * @example 200 - two hundred short turns are about 20k tokens, enough for a 128k window at ratio 0.8 with a big system prompt
   *
   * @default 200
   */
  maxLoadedTurns?: number;
}

/**
 * A summary + facts kept by the cheap model after every `updateEveryTurns` turns, plus the last `recentTurns` turns
 * verbatim.
 *
 * Read by `WorkingMemory.load` and `saveContext`.
 */
export interface IWorkingMemorySummaryBuffer {
  type: EWorkingMemoryStrategy.SUMMARY_BUFFER;
  /**
   * Verbatim turns sent after the summary, newest last.
   *
   * > The tail the summary does not cover yet.
   *
   * @example 20 - a chat of normal length fits a 128k model with room for the knowledge-base chunks
   *
   * @default 20
   */
  recentTurns?: number;
  /**
   * Run the LLM update once the thread grew by N turns (`IThread.turnCount`) since the last update.
   *
   * @default 1
   */
  updateEveryTurns?: number;
  /**
   * Cap for the summary, in characters.
   *
   * @default 1500
   */
  maxSummaryChars?: number;
  /**
   * Cap for the number of facts.
   *
   * @default 30
   */
  maxFacts?: number;
}

/**
 * One of the two strategies, told apart by `type`.
 *
 * The value of `IWorkingMemoryConfig.strategy` and of `IAIProfile.workingMemory`.
 */
export type TWorkingMemoryStrategy =
  | IWorkingMemorySlidingWindow
  | IWorkingMemorySummaryBuffer;

/** Configuration of the built-in WorkingMemory. Lands in IAIGatewayConfig.workingMemory. */
export interface IWorkingMemoryConfig {
  /**
   * The switch of the thread memory.
   *
   * > Off: nothing is remembered and no helper model is called; `load` still gives the last 20 turns, so the model sees the conversation.
   *
   * No default: it is decided where the gateway is configured.
   */
  enabled: boolean;
  /**
   * The gateway's default strategy; a profile's `workingMemory` overrides it.
   *
   * > Decides whether the model reads the raw history or a digest of it.
   *
   * @example {type: EWorkingMemoryStrategy.SLIDING_WINDOW} - precise chat on every profile that does not say otherwise
   *
   * @default {type: EWorkingMemoryStrategy.SUMMARY_BUFFER} - today's behaviour, with the defaults of `IWorkingMemorySummaryBuffer`
   */
  strategy?: TWorkingMemoryStrategy;
}

/** Shared instances WorkingMemory needs; created once by AIGateway and passed as the second constructor argument. */
export interface IWorkingMemoryDeps {
  llmClient: ILLMClient;
  promptTemplateStore: IPromptTemplateStore;
  threadStore: IThreadStore;
  turnBuilder: ITurnBuilder;
}

/** The compressed state of a thread. Stored on IThread.workingMemory. */
export interface IWorkingMemoryState {
  /** Prose summary of everything older than the last N turns. */
  summary: string;
  /** Key facts as key/value, e.g. role: developer. */
  facts: Record<string, string>;
  /** TurnCount at last update; the gateway uses it to decide when to update. */
  updatedAtTurn: number;
}
