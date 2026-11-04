import {IIssue} from "../../../contracts";

import {
  IResultReviewEnvelope,
  EPauseKind,
  EResumeAction,
} from "../types";

/**
 * makeResultReviewDraft -- the card of an answer that waits for a reviewer
 *
 * # About
 *
 * > What the end user would have received, shown to the reviewer first.
 *
 * A RESULT_REVIEW envelope (D99) whose `result` is the checked answer (text, the parsed `structured` when there is one,
 * the citations, the warnings) and whose allowed actions are APPROVE, EDIT, REJECT.
 *
 * # Who needs it
 *
 * `settleReviewPause`, after the output checks passed, before `HumanGate.pause`.
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
