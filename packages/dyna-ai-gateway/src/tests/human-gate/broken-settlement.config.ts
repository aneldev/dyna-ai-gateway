import {IAIGatewayConfig} from "../..";

import {FailingRunRepository} from "../internal/utils/FailingRunRepository";

import {gatewayConfigAbortedResumeAfterTheTool} from "./aborted-resume-after-the-tool.config";

/** The quick refund of `gatewayConfigAbortedResumeAfterTheTool` on a run store that can fail on demand. */
export const gatewayConfigBrokenSettlement: IAIGatewayConfig = {
  ...gatewayConfigAbortedResumeAfterTheTool,
  runStore: {repository: new FailingRunRepository()},
};
