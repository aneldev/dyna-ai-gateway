import {IIssue} from "../contracts";
import {ELLMClientEventKind} from "../internal";

import {TOnCallEventHandler} from "./startCall";

/**
 * emitAnswerWithdrawn -- tells the stream that the answer it rendered is not the answer (D74)
 *
 * # About
 *
 * > The text was streamed before the checks; the client must take it back.
 *
 * Sends one ANSWER_WITHDRAWN event on the call's stream, after DONE, with the issues that withdrew the answer: a failed
 * output check, a refused judge call, an abort that landed after the text was streamed, a reviewer's REJECT.
 *
 * # Who needs it
 *
 * `AIGateway.executeAsk`, `settleRun`, `settleReview`.
 */
export const emitAnswerWithdrawn = (
  {
    onEvent,
    issues,
    stepIndex = 0,
  }: {
    onEvent: TOnCallEventHandler;
    issues: IIssue[];
    /** The final step of a run; 0 for ask(). */
    stepIndex?: number;
  },
): void => onEvent({
  event: {
    kind: ELLMClientEventKind.ANSWER_WITHDRAWN,
    issues,
    stepIndex,
  },
});
