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

/** The counted refund (pauses on every call): the tests move its run to RUNNING by hand, as a resume cut by a dead instance leaves it (D97). */
export const gatewayConfigStuckRun: IAIGatewayConfig = {
  ...gatewayConfigConcurrentResume,
  humanGate: {userQuestions: {enabled: false}},
};
