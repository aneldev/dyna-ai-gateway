import {
  IAIGatewayConfig,
  IInputRule,
  IIssue,
} from "../..";

import {gatewayConfigUserQuestion} from "./user-question.config";

/** The controller of the resume under test; the rule presses "stop" on it when one is set. */
export const answerScreenAbort: {controller?: AbortController} = {};

/**
 * An input rule that presses "stop" on `answerScreenAbort.controller` while it screens, then passes: on a resume the abort
 * lands while the answer is screened, before the run leaves PAUSED. The first prompt of the run sees no controller and passes.
 */
export const stopWhileScreeningRule: IInputRule = {
  name: "stop-while-screening",
  check: async (): Promise<IIssue[]> => {
    answerScreenAbort.controller?.abort();
    await new Promise(resolve => setTimeout(resolve, 5));
    return [];
  },
};

/** The user-question tool switched on, plus the rule that aborts the resume from inside the answer screen. */
export const gatewayConfigAbortedAnswerScreen: IAIGatewayConfig = {
  ...gatewayConfigUserQuestion,
  guardrails: {inputRules: [stopWhileScreeningRule]},
};
