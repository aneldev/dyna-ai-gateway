import {IAIGatewayConfig} from "../..";

import {gatewayConfigReviewAnswers} from "./review-answers.config";

/** How long a review of this scenario waits for a human, in ms; the test moves a fake clock past it. */
export const REVIEW_TIMEOUT_MS = 60_000;

/** The reviewing profile with a short pause limit: the scenario of the expiry job on a review pause (D99). */
export const gatewayConfigExpiringReview: IAIGatewayConfig = {
  ...gatewayConfigReviewAnswers,
  humanGate: {
    timeoutMs: REVIEW_TIMEOUT_MS,
    userQuestions: {enabled: false},
  },
};
