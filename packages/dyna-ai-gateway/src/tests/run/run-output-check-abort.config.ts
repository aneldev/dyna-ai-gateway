import {
  IAIGatewayConfig,
  IIssue,
  IOutputRule,
} from "../..";

import {
  gatewayConfigAbortAfterATool,
  logEventTool,
} from "./abort-after-a-tool.config";

/** The controller of the run under test; the rule presses "stop" on it when one is set. */
export const runOutputCheckAbort: {controller?: AbortController} = {};

/** An output rule that presses "stop" on `runOutputCheckAbort.controller` while it checks the final answer, then passes. */
export const stopDuringOutputCheckRule: IOutputRule = {
  name: "stop-during-output-check",
  check: async (): Promise<IIssue[]> => {
    runOutputCheckAbort.controller?.abort();
    await new Promise(resolve => setTimeout(resolve, 5));
    return [];
  },
};

/** The quick tool of `gatewayConfigAbortAfterATool`, plus the rule that aborts the run from inside the output check. */
export const gatewayConfigRunOutputCheckAbort: IAIGatewayConfig = {
  ...gatewayConfigAbortAfterATool,
  guardrails: {outputRules: [stopDuringOutputCheckRule]},
};

export {
  logEventTool,
};
