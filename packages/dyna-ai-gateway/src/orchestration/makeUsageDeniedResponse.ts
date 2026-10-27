import {
  IIssue,
  EIssueSeverity,
} from "../contracts";
import {IUsageDeniedErrorData} from "../internal";
import {
  IFailedResponse,
  USAGE_DENIED_ISSUE_CODE,
} from "../types";

import {makeFailedResponse} from "./makeFailedResponse";

/** The `reason` of a FAILED response whose model call the usage adapter refused. */
export const USAGE_DENIED_REASON = "The usage adapter refused the model call";

/**
 * makeUsageDeniedIssue -- the issue of a model call the usage adapter refused
 *
 * # About
 *
 * > The app's no, as an issue: its code in `data.denyCode`, its words in `userMessage`.
 *
 * ERROR when the refusal failed the call, WARNING when a run kept the answer of its earlier steps because a later step was
 * refused. `message` names the refused call's trace id for the log; it is not the user's text.
 *
 * # Who needs it
 *
 * `makeUsageDeniedResponse`, and `settleRun` for the WARNING of a truncated run.
 */
export const makeUsageDeniedIssue = (
  {
    denied,
    severity,
  }: {
    /** The `data` of the error `isUsageDeniedError` recognised. */
    denied: IUsageDeniedErrorData;
    severity: EIssueSeverity;
  },
): IIssue => ({
  code: USAGE_DENIED_ISSUE_CODE,
  message: `The usage adapter refused the model call [${denied.traceId}]${denied.denyCode === undefined ? "" : ` (${denied.denyCode})`}`,
  severity,
  ...denied.denyUserMessage === undefined ? {} : {userMessage: denied.denyUserMessage},
  ...denied.denyCode === undefined ? {} : {data: {denyCode: denied.denyCode}},
});

/**
 * makeUsageDeniedResponse -- the FAILED response of a call whose model call the usage adapter refused
 *
 * # About
 *
 * > The call ended on the app's word: the response says so, nothing is thrown.
 *
 * Built when a layer threw the usage-denied error (`isUsageDeniedError`) and the call cannot go on without that model call:
 * the input judges, the query rewrite, the search's embedding, the answer, the first step of a run, the output judges.
 * `issues` holds one ERROR issue `USAGE_DENIED_ISSUE_CODE`, so a host branches on the code, not on the prose.
 *
 * # Who needs it
 *
 * `AIGateway` (`failedResponseOrThrow`).
 */
export const makeUsageDeniedResponse = (
  {
    threadId,
    denied,
  }: {
    /** The call's thread when it has one; what the call stored there before the refusal stays. */
    threadId?: string;
    denied: IUsageDeniedErrorData;
  },
): IFailedResponse => makeFailedResponse({
  threadId,
  reason: USAGE_DENIED_REASON,
  issues: [
    makeUsageDeniedIssue({
      denied,
      severity: EIssueSeverity.ERROR,
    }),
  ],
});
