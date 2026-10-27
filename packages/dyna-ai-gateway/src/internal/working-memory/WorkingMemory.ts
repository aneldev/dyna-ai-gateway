import {ITurn} from "../../contracts";

import {IAIProfile} from "../ai-profile-store";
import {
  ILLMClientCallMeta,
  IModelRequest,
  IModelResult,
} from "../llm-client";
import {IModelInfo} from "../model-registry";

import {
  IWorkingMemory,
  IWorkingMemoryConfig,
  IWorkingMemoryDeps,
  IWorkingMemoryLoad,
  IWorkingMemoryState,
  EWorkingMemoryStrategy,
} from "./types";
import {loadSlidingWindow} from "./utils/loadSlidingWindow";
import {loadSummaryBuffer} from "./utils/loadSummaryBuffer";
import {resolveStrategy} from "./utils/resolveStrategy";
import {startOnUserTurn} from "./utils/startOnUserTurn";
import {updateSummary} from "./utils/updateSummary";

/** The window while the memory is switched off: the model still reads the conversation, nothing is remembered. */
const DISABLED_TURNS = 20;
/** The most turns one summary update sends, unless updateEveryTurns is larger. */
const MAX_CATCH_UP_TURNS = 20;

/**
 * WorkingMemory -- the built-in thread memory, two strategies behind one interface
 *
 * # About
 *
 * > The gateway asks "what should the model know from this thread?"; the strategy answers.
 *
 * Implements `IWorkingMemory` for the two built-in strategies of `EWorkingMemoryStrategy`, chosen per call from the
 * profile's `workingMemory`, else the config's `strategy`, else `SUMMARY_BUFFER`:
 *
 * - `SLIDING_WINDOW`: `load` gives the newest turns that fit `chatHistoryRatio` of the history budget, counted with the
 *   model's tokenizer; `saveContext` does nothing, nothing is stored.
 * - `SUMMARY_BUFFER`: `load` gives the stored summary + facts as the notes and the last `recentTurns` turns; `saveContext`
 *   has the cheap model rewrite the summary + facts once the thread grew by `updateEveryTurns` turns.
 * - Switched off (`enabled: false`): `load` gives the last 20 turns and no notes; `saveContext` does nothing.
 *
 * Every window opens on a user turn: a leading assistant or tool turn is dropped, the providers reject a tool result
 * without its call.
 *
 * It sits between the `ThreadStore` (the turns and the stored state) and the `ContextAssembler` (the request).
 *
 * # Who needs it
 *
 * `ContextAssembler.build` calls `load` for every request; the background memory update calls `saveContext` after every
 * answer; `AIGateway.getThreadMemory` and `AIGateway.resetThreadMemory` call `getState` and `reset`. A host replaces it
 * with its own `IWorkingMemory` in `overrides.workingMemory`.
 *
 * # What needs
 *
 * `threadStore` for the turns and the state, `turnBuilder` for turns → messages, `promptTemplateStore` for the
 * MEMORY_WORKING template and `llmClient` for the cheap-model call of `SUMMARY_BUFFER`.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, through the gateway: it is created by `createGatewayDeps` from `IAIGatewayConfig.workingMemory`.
 *
 * ## When shouldn't use it
 *
 * A host with its own memory model (a vector memory, a graph, a different summary) implements `IWorkingMemory` instead
 * and passes it in `overrides`.
 *
 * # Pitfalls
 *
 * A thread keeps its stored summary when its profile switches to `SLIDING_WINDOW`: the summary is ignored, not wiped,
 * so a switch back resumes from it. `getState` shows it meanwhile.
 */
export class WorkingMemory implements IWorkingMemory {
  constructor(
    private readonly config: IWorkingMemoryConfig,
    private readonly deps: IWorkingMemoryDeps,
  ) {}

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
  public async load(
    {
      tenantId,
      threadId,
      profile,
      model,
      budgetTokens,
    }: {
      tenantId: string;
      threadId: string;
      /** The call's profile; `profile.workingMemory` may override the gateway's strategy. */
      profile: IAIProfile;
      model: IModelInfo;
      /** Tokens left for the history after the system prompt and the output reserve. */
      budgetTokens: number;
    },
  ): Promise<IWorkingMemoryLoad> {
    const thread = await this.deps.threadStore.getThread({
      tenantId,
      threadId,
    });
    const getLastTurns = (limit: number): Promise<ITurn[]> => this.deps.threadStore.getLastTurns({
      tenantId,
      threadId,
      limit,
    });

    if (!this.config.enabled) {
      return {
        messages: this.deps.turnBuilder.toMessages({turns: startOnUserTurn(await getLastTurns(DISABLED_TURNS))}),
        notes: "",
        issues: [],
      };
    }

    const strategy = resolveStrategy({
      config: this.config,
      profile,
    });
    if (strategy.type === EWorkingMemoryStrategy.SLIDING_WINDOW) {
      return loadSlidingWindow({
        turns: await getLastTurns(strategy.maxLoadedTurns),
        turnCount: thread.turnCount,
        model,
        budgetTokens,
        strategy,
        turnBuilder: this.deps.turnBuilder,
      });
    }
    return loadSummaryBuffer({
      turns: await getLastTurns(strategy.recentTurns),
      state: thread.workingMemory,
      turnBuilder: this.deps.turnBuilder,
    });
  }

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
  public async saveContext(
    {
      tenantId,
      threadId,
      profile,
      cheapModelId,
      meta,
    }: {
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
    },
  ): Promise<void> {
    if (!this.config.enabled) return;
    const strategy = resolveStrategy({
      config: this.config,
      profile,
    });
    if (strategy.type !== EWorkingMemoryStrategy.SUMMARY_BUFFER) return;

    try {
      const thread = await this.deps.threadStore.getThread({
        tenantId,
        threadId,
      });
      const behind = thread.turnCount - thread.workingMemory.updatedAtTurn;
      if (behind < strategy.updateEveryTurns) return;

      // After failed updates the gap grows with every turn and would outgrow the cheap model's window
      // Only the latest turns are sent, and the memory counts as updated up to now: the older ones are left behind for good
      const newTurns = await this.deps.threadStore.getLastTurns({
        tenantId,
        threadId,
        limit: Math.min(behind, Math.max(MAX_CATCH_UP_TURNS, strategy.updateEveryTurns)),
      });
      await updateSummary({
        deps: this.deps,
        options: strategy,
        tenantId,
        threadId,
        current: thread.workingMemory,
        newTurns,
        upToTurn: thread.turnCount,
        cheapModelId,
        meta,
      });
    }
    catch (error) {
      console.error(`Internal error 53725977158853: WorkingMemory: the memory of thread [${threadId}] was not updated`, error);
    }
  }

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
  public async getState(
    {
      tenantId,
      threadId,
    }: {
      tenantId: string;
      threadId: string;
    },
  ): Promise<IWorkingMemoryState> {
    const thread = await this.deps.threadStore.getThread({
      tenantId,
      threadId,
    });
    return thread.workingMemory;
  }

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
  public async reset(
    {
      tenantId,
      threadId,
    }: {
      tenantId: string;
      threadId: string;
    },
  ): Promise<void> {
    const thread = await this.deps.threadStore.getThread({
      tenantId,
      threadId,
    });
    await this.deps.threadStore.setWorkingMemory({
      tenantId,
      threadId,
      state: {
        summary: "",
        facts: {},
        updatedAtTurn: thread.turnCount,
      },
    });
  }
}
