import {
  IAIGatewayConfig,
  IIssue,
  IOutputRule,
} from "../..";

import {
  gatewayConfigAbortedResumeAfterTheTool,
  quickRefundTool,
} from "./aborted-resume-after-the-tool.config";

/** The controller of the resume under test; the rule presses "stop" on it when one is set. */
export const abortedResumeOutputCheck: {controller?: AbortController} = {};

/** An output rule that presses "stop" on `abortedResumeOutputCheck.controller` while it checks the final answer, then passes. */
export const stopDuringResumeOutputCheckRule: IOutputRule = {
  name: "stop-during-resume-output-check",
  check: async (): Promise<IIssue[]> => {
    abortedResumeOutputCheck.controller?.abort();
    await new Promise(resolve => setTimeout(resolve, 5));
    return [];
  },
};

/** The quick refund of `gatewayConfigAbortedResumeAfterTheTool`, plus the rule that aborts the resume from inside the output check. */
export const gatewayConfigAbortedResumeOutputCheck: IAIGatewayConfig = {
  ...gatewayConfigAbortedResumeAfterTheTool,
  guardrails: {outputRules: [stopDuringResumeOutputCheckRule]},
};

export {
  quickRefundTool,
};
