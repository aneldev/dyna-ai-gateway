import {ITurn} from "../contracts";
import {IAIGatewayDeps} from "../types";

/**
 * appendTurns -- appends the turns to the thread, one after the other
 *
 * # About
 *
 * > One `ThreadStore.appendTurn` per turn, in order.
 *
 * Every write of turns in the gateway goes through it: the user turn of `prepareCall`, the assistant and tool turns of
 * `executeAsk`, `settleRun`, `settleReviewPause` and `settleReview`, the results `closeRun` writes for the calls a run left
 * unanswered.
 *
 * # Who needs it
 *
 * `prepareCall`, `AIGateway.executeAsk`, `settleRun`, `settleReviewPause`, `settleReview`, `closeRun`.
 *
 * # Pitfalls
 *
 * Not atomic: a store that fails on the second turn leaves the first one stored. The callers' order of turns is the order
 * the thread shows.
 */
export const appendTurns = async (
  {
    deps,
    tenantId,
    threadId,
    turns,
  }: {
    deps: IAIGatewayDeps;
    tenantId: string;
    threadId: string;
    turns: ITurn[];
  },
): Promise<void> => {
  for (const turn of turns) {
    await deps.threadStore.appendTurn({
      tenantId,
      threadId,
      turn,
    });
  }
};
