import {
  ITurn,
  ETurnRole,
} from "../../../contracts";

/**
 * Drops the leading turns up to the first USER turn: a window that opens with an assistant or a tool turn is a
 * conversation the providers reject (a tool result without its call). Unchanged when it already starts with a user turn
 * or holds no user turn at all.
 */
export const startOnUserTurn = (turns: ITurn[]): ITurn[] => {
  const index = turns.findIndex(turn => turn.role === ETurnRole.USER);
  return index <= 0 ? turns : turns.slice(index);
};
