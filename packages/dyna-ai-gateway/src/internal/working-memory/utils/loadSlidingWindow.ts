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
 * The SLIDING_WINDOW window: the newest turns that fit `chatHistoryRatio × budgetTokens`, at least the last one,
 * opened on a user turn. `turns` are the newest `maxLoadedTurns` of the thread, oldest first; `turnCount` is the
 * thread's total, for the `turns_trimmed` WARNING.
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
