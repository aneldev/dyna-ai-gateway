import {IAIGatewayConfig} from "../..";

import {
  countedRefundTool,
  gatewayConfigConcurrentResume,
  refundExecutions,
} from "./concurrent-resume.config";

export {
  countedRefundTool,
  refundExecutions,
};

/** How long a pause of this scenario waits for a human, in ms; the tests move a fake clock past it. */
export const PAUSE_TIMEOUT_MS = 60_000;

/** The counted refund (pauses on every call) with a short pause limit: the scenario of the expiry job (M6.7). */
export const gatewayConfigExpiringPause: IAIGatewayConfig = {
  ...gatewayConfigConcurrentResume,
  humanGate: {
    timeoutMs: PAUSE_TIMEOUT_MS,
    userQuestions: {enabled: false},
  },
};
