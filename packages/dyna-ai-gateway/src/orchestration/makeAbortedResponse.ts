import {EIssueSeverity} from "../contracts";
import {
  IFailedResponse,
  CALL_ABORTED_ISSUE_CODE,
  CALL_TIMED_OUT_ISSUE_CODE,
} from "../types";

import {
  abortReason,
  isTimedOut,
} from "./abortReason";
import {ICallSignal} from "./makeCallSignal";
import {makeFailedResponse} from "./makeFailedResponse";

/**
 * makeAbortedResponse -- the FAILED response of a call that was aborted or timed out
 *
 * # About
 *
 * > The call ended on the caller's word, not on an error: the response says so, nothing is thrown.
 *
 * Built when the call's signal is aborted, whether before anything ran, when a layer threw the signal's reason or when the
 * agent loop came back aborted. `reason` is `abortReason`; `issues` holds one ERROR issue whose `code` is
 * `CALL_TIMED_OUT_ISSUE_CODE` or `CALL_ABORTED_ISSUE_CODE`, so a host branches on the code, not on the prose (as `USAGE_DENIED_ISSUE_CODE`).
 *
 * # Who needs it
 *
 * `AIGateway` (`ask`, `run`, `executeResume`, `failedResponseOrThrow`), `prepareCall`, `settleRun`.
 */
export const makeAbortedResponse = (
  {
    threadId,
    callSignal,
  }: {
    /** The call's thread when it has one; what the call stored there before the stop stays. */
    threadId?: string;
    /** The call's signal, already aborted. */
    callSignal: ICallSignal;
  },
): IFailedResponse => {
  const reason = abortReason({callSignal});
  return makeFailedResponse({
    threadId,
    reason,
    issues: [
      {
        code: isTimedOut({callSignal}) ? CALL_TIMED_OUT_ISSUE_CODE : CALL_ABORTED_ISSUE_CODE,
        message: reason,
        severity: EIssueSeverity.ERROR,
      },
    ],
  });
};
