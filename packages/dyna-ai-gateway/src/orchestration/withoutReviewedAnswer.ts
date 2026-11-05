import {
  TPauseEnvelope,
  EPauseKind,
} from "../internal";

/**
 * withoutReviewedAnswer -- the pause envelope as the asker may see it
 *
 * # About
 *
 * > The draft is the reviewer's until decided: a RESULT_REVIEW envelope loses its `result`.
 *
 * Any other envelope is returned as it is. The PAUSED response of a reviewed run (`settleReviewPause`) and the asker's list
 * (`listPausedRuns`) go through it; `getPausedRun`, the reviewer's read, does not.
 *
 * # Who needs it
 *
 * `settleReviewPause` and `AIGateway.listPausedRuns`.
 */
export const withoutReviewedAnswer = (envelope: TPauseEnvelope): TPauseEnvelope => {
  if (envelope.kind !== EPauseKind.RESULT_REVIEW) return envelope;
  const {
    result: _draft,
    ...withoutDraft
  } = envelope;
  return withoutDraft;
};
