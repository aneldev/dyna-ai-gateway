import {
  ITurn,
  ETurnRole,
} from "../../../contracts";

/**
 * startOnUserTurn -- opens a window on a user turn
 *
 * # About
 *
 * > A conversation starts with the user; the providers reject one that does not.
 *
 * Drops the leading turns up to the first USER turn: a window that opens with an assistant or a tool turn is a tool
 * result without its call, and the providers reject it. Unchanged when it already starts with a user turn or holds no
 * user turn at all.
 *
 * # Who needs it
 *
 * `loadSlidingWindow`, `loadSummaryBuffer` and the disabled path of `WorkingMemory.load`, on every window.
 *
 * # Pitfalls
 *
 * The turns dropped are gone for this request only; the thread keeps them.
 */
export const startOnUserTurn = (turns: ITurn[]): ITurn[] => {
  const index = turns.findIndex(turn => turn.role === ETurnRole.USER);
  return index <= 0 ? turns : turns.slice(index);
};
