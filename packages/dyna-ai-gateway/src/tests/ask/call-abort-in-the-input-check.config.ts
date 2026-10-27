import {
  IAIGatewayConfig,
  IInputRule,
  IIssue,
  InMemoryThreadRepository,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The controller of the call under test; the rule presses "stop" on it when one is set. */
export const inputCheckAbort: {controller?: AbortController} = {};

/** An input rule that presses "stop" on `inputCheckAbort.controller` while it screens: the abort lands before the thread exists. */
export const stopWhileCheckingRule: IInputRule = {
  name: "stop-while-checking",
  check: async (): Promise<IIssue[]> => {
    inputCheckAbort.controller?.abort();
    await new Promise(resolve => setTimeout(resolve, 5));
    return [];
  },
};

/** Plain chat on its own thread repository (so the test counts the threads), plus the rule that aborts from inside the input check. */
export const gatewayConfigCallAbortInTheInputCheck: IAIGatewayConfig = {
  ...gatewayConfigBase,
  threadStore: {repository: new InMemoryThreadRepository()},
  guardrails: {inputRules: [stopWhileCheckingRule]},
};
