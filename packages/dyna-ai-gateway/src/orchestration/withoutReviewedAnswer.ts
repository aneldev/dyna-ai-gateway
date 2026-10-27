import {
  TPauseEnvelope,
  EPauseKind,
} from "../internal";

/**
 * The envelope as the asker may see it: a RESULT_REVIEW without its `result` (the draft is the reviewer's until decided);
 * any other envelope as it is. The PAUSED response and `listPausedRuns` go through it; `getPausedRun` does not.
 */
export const withoutReviewedAnswer = (envelope: TPauseEnvelope): TPauseEnvelope => {
  if (envelope.kind !== EPauseKind.RESULT_REVIEW) return envelope;
  const {
    result: _draft,
    ...withoutDraft
  } = envelope;
  return withoutDraft;
};
