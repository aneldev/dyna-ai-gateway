import {
  IAIGatewayConfig,
  IIssue,
  IOutputRule,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The controller of the call under test; the rule presses "stop" on it when one is set. */
export const callAbort: {controller?: AbortController} = {};

/**
 * An output rule that presses "stop" on `callAbort.controller` while it is still working, then passes the answer: the abort lands
 * mid-call, after the user turn is stored and before the answer is, as a stop pressed while a check (a judge call) is in flight.
 */
export const stopPressingRule: IOutputRule = {
  name: "stop-pressing",
  check: async (): Promise<IIssue[]> => {
    callAbort.controller?.abort();
    await new Promise(resolve => setTimeout(resolve, 5));
    return [];
  },
};

/** Plain chat plus the rule that aborts the call from inside. */
export const gatewayConfigCallAbort: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {outputRules: [stopPressingRule]},
};
