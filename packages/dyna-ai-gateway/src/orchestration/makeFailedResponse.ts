import {IIssue} from "../contracts";
import {
  IFailedResponse,
  EGatewayResponseKind,
} from "../types";

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
