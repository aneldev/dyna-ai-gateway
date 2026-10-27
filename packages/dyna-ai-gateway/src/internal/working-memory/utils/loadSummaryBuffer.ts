import {ITurn} from "../../../contracts";

import {ITurnBuilder} from "../../turn-builder";

import {
  IWorkingMemoryLoad,
  IWorkingMemoryState,
} from "../types";

import {startOnUserTurn} from "./startOnUserTurn";

/**
 * The SUMMARY_BUFFER window: the stored summary and facts as the notes, the last `recentTurns` turns (already read,
 * oldest first) as the messages, opened on a user turn. The notes are "" while nothing is stored.
 */
export const loadSummaryBuffer = (
  {
    turns,
    state,
    turnBuilder,
  }: {
    turns: ITurn[];
    state: IWorkingMemoryState;
    turnBuilder: ITurnBuilder;
  },
): IWorkingMemoryLoad => ({
  messages: turnBuilder.toMessages({turns: startOnUserTurn(turns)}),
  notes: formatNotes(state),
  issues: [],
});

const formatNotes = (state: IWorkingMemoryState): string => {
  const factLines = Object.entries(state.facts).map(([key, value]) => `- ${key}: ${value}`);
  if (!state.summary && !factLines.length) return "";
  return ["About this conversation so far:", state.summary, ...factLines].filter(Boolean).join("\n");
};
