import {IIssue} from "../contracts";
import {
  IFailedResponse,
  EGatewayResponseKind,
} from "../types";

/**
 * makeFailedResponse -- the FAILED response of a call, with its reason and issues
 *
 * # About
 *
 * > One shape for every call that ends without an answer and without throwing.
 *
 * The one constructor of `IFailedResponse`: a rejected prompt, a blocked answer, a rejected review, an abort
 * (`makeAbortedResponse`), a refused model call (`makeUsageDeniedResponse`). `threadId` is present when the call had or
 * created a thread; what the call stored there stays.
 *
 * # Who needs it
 *
 * `prepareCall`, `settleRun`, `settleReview`, `makeAbortedResponse`, `makeUsageDeniedResponse`, `AIGateway.executeAsk`
 * and `continueRun`.
 */
export const makeFailedResponse = (
  {
    threadId,
    reason,
    issues,
  }: {
    threadId?: string;
    reason: string;
    issues: IIssue[];
  },
): IFailedResponse => ({
  kind: EGatewayResponseKind.FAILED,
  threadId,
  reason,
  issues,
});
