import {IIssue} from "../contracts";
import {ELLMClientEventKind} from "../internal";

import {TOnCallEventHandler} from "./startCall";

/** Sends ANSWER_WITHDRAWN on the call's stream (D74): after DONE, with the issues of the failed output check. */
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
