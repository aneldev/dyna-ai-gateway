import {IIssue} from "../../../contracts";

import {
  IResultReviewEnvelope,
  EPauseKind,
  EResumeAction,
} from "../types";

/**
 * The envelope of a run paused for the review of its answer (D99): what the reviewer sees is what the end user would have
 * received, and the reviewer may approve, edit or reject it. Built by the gateway's settlement after the output checks passed.
 */
export const makeResultReviewDraft = (
  {
    text,
    structured,
    citations,
    issues,
  }: {
    text: string;
    /** The parsed, schema-checked answer; omitted when the run had no `outputSchema`. */
    structured?: unknown;
    citations: string[];
    issues: IIssue[];
  },
): Omit<IResultReviewEnvelope, "runId" | "pauseId" | "expiresAt"> => ({
  kind: EPauseKind.RESULT_REVIEW,
  result: {
    text,
    ...structured === undefined ? {} : {structured},
    citations,
    issues,
  },
  allowed: [EResumeAction.APPROVE, EResumeAction.EDIT, EResumeAction.REJECT],
});
