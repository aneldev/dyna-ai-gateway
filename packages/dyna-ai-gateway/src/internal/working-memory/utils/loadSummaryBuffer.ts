import {ITurn} from "../../../contracts";

import {ITurnBuilder} from "../../turn-builder";

import {
  IWorkingMemoryLoad,
  IWorkingMemoryState,
} from "../types";

import {startOnUserTurn} from "./startOnUserTurn";

/**
 * loadSummaryBuffer -- the SUMMARY_BUFFER window of one request
 *
 * # About
 *
 * > The digest as the notes, the tail verbatim.
 *
 * The messages are `turns` (the last `recentTurns` of the thread, already read, oldest first) opened on a user turn
 * (`startOnUserTurn`); the notes are the stored summary and facts rendered by `formatNotes`, "" while nothing is stored.
 * No budget is checked here and no issue is raised.
 *
 * # Who needs it
 *
 * `WorkingMemory.load`, when the resolved strategy is `SUMMARY_BUFFER`.
 *
 * # Pitfalls
 *
 * A tail that does not fit the history budget is trimmed by the `ContextAssembler`, not here, with its `turns_trimmed`
 * warning.
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

/** The notes text: heading, summary, one "- key: value" line per fact; "" when empty. */
const formatNotes = (state: IWorkingMemoryState): string => {
  const factLines = Object.entries(state.facts).map(([key, value]) => `- ${key}: ${value}`);
  if (!state.summary && !factLines.length) return "";
  return ["About this conversation so far:", state.summary, ...factLines].filter(Boolean).join("\n");
};
