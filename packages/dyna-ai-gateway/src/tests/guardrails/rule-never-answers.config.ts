import {
  IAIGatewayConfig,
  IIssue,
  IInputRule,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** How long a rule may take in this scenario, in ms; short so the test is quick. */
export const RULE_TIMEOUT_MS = 50;

/** A rule whose check never settles until its signal is aborted: a hanging judge or a hanging service behind the rule. */
export const hangingRule: IInputRule = {
  name: "hanging",
  check: ({abortSignal}): Promise<IIssue[]> => new Promise((_resolve, reject) => {
    abortSignal.addEventListener("abort", () => reject(new Error("aborted")));
  }),
};

/** One rule that never answers; the gateway's rule timeout is the only thing that ends the call. */
export const gatewayConfigRuleNeverAnswers: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {
    ruleTimeoutMs: RULE_TIMEOUT_MS,
    inputRules: [hangingRule],
  },
};
