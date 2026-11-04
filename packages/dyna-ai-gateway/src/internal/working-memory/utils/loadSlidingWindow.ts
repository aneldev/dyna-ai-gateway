import {
  ITurn,
  EIssueSeverity,
} from "../../../contracts";

import {estimateMessagesTokens} from "../../llm-client";
import {IModelInfo} from "../../model-registry";
import {ITurnBuilder} from "../../turn-builder";

import {
  IWorkingMemoryLoad,
  IWorkingMemorySlidingWindow,
} from "../types";

import {startOnUserTurn} from "./startOnUserTurn";

/**
 * loadSlidingWindow -- the SLIDING_WINDOW window of one request
 *
 * # About
 *
 * > Newest first, until the share is full; at least the newest turn.
 *
 * Counts every turn with the model's tokenizer (`estimateMessagesTokens`), walks from the newest back and keeps the turns
 * while they fit `chatHistoryRatio × budgetTokens`; the newest turn is always kept. The window is then opened on a user
 * turn (`startOnUserTurn`). The notes are "" (nothing is stored under this strategy). When fewer turns than the thread
 * holds (`turnCount`) are in the window, a `turns_trimmed` WARNING says how many made it.
 *
 * `turns` are the newest `maxLoadedTurns` of the thread, oldest first, already read by the caller.
 *
 * # Who needs it
 *
 * `WorkingMemory.load`, when the resolved strategy is `SLIDING_WINDOW`.
 *
 * # Pitfalls
 *
 * A thread longer than `maxLoadedTurns` is trimmed by the read, not by the budget: the warning appears although the
 * budget had room. `startOnUserTurn` may drop one more turn than the budget did.
 */
export const loadSlidingWindow = (
  {
    turns,
    turnCount,
    model,
    budgetTokens,
    strategy,
    turnBuilder,
  }: {
    turns: ITurn[];
    turnCount: number;
    model: IModelInfo;
    budgetTokens: number;
    strategy: Required<IWorkingMemorySlidingWindow>;
    turnBuilder: ITurnBuilder;
  },
): IWorkingMemoryLoad => {
  const share = Math.floor(strategy.chatHistoryRatio * budgetTokens);
  const kept: ITurn[] = [];
  let total = 0;
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    const tokens = estimateMessagesTokens({
      messages: turnBuilder.toMessages({turns: [turn]}),
      provider: model.provider,
    });
    if (kept.length && total + tokens > share) break;
    kept.unshift(turn);
    total += tokens;
  }
  const window = startOnUserTurn(kept);
  return {
    messages: turnBuilder.toMessages({turns: window}),
    notes: "",
    issues: window.length < turnCount
      ? [
        {
          code: "turns_trimmed",
          message: `Older turns were left out: ${window.length} of ${turnCount} turns are in the request`,
          severity: EIssueSeverity.WARNING,
        },
      ]
      : [],
  };
};
