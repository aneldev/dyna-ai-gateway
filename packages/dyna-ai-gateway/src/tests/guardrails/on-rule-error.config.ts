import {
  IAIGatewayConfig,
  IIssue,
  IInputRule,
  IOutputRule,
  IRuleErrorReport,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

import {scopeJudgeRule} from "./judge-scope.config";
import {
  RULE_TIMEOUT_MS,
  hangingRule,
} from "./rule-never-answers.config";

/** Every report the handler received; a test empties it before its call. */
export const ruleErrorReports: IRuleErrorReport[] = [];

/** What the throwing rules throw: a service error with a detail the caller must never see. */
export const ruleFailure = new Error("moderation service: connection refused at 10.0.0.7:8443");

/** What the handler of `gatewayConfigOnRuleErrorThatThrows` throws. */
export const HANDLER_FAILURE_MESSAGE = "the developer's logger is down";

/** An input rule whose service fails. */
export const throwingInputRule: IInputRule = {
  name: "moderation",
  check: (): Promise<IIssue[]> => Promise.reject(ruleFailure),
};

/** An output rule whose service fails. */
export const throwingOutputRule: IOutputRule = {
  name: "grounding",
  check: (): Promise<IIssue[]> => Promise.reject(ruleFailure),
};

const guardrailsListening = {
  ruleTimeoutMs: RULE_TIMEOUT_MS,
  onRuleError: (report: IRuleErrorReport): void => {
    ruleErrorReports.push(report);
  },
};

/** A developer listening on `onRuleError`; one input rule that throws. */
export const gatewayConfigOnRuleError: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {
    ...guardrailsListening,
    inputRules: [throwingInputRule],
  },
};

/** A developer listening on `onRuleError`; one output rule that throws. */
export const gatewayConfigOnRuleErrorOnOutput: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {
    ...guardrailsListening,
    outputRules: [throwingOutputRule],
  },
};

/** A developer listening on `onRuleError`; one input rule that never answers. */
export const gatewayConfigOnRuleErrorTimeout: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {
    ...guardrailsListening,
    inputRules: [hangingRule],
  },
};

/** A developer listening on `onRuleError`; one input rule that asks the judge, whose answer the test scripts. */
export const gatewayConfigOnRuleErrorJudge: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {
    ...guardrailsListening,
    inputRules: [scopeJudgeRule],
  },
};

/** One input rule that throws, and a handler that throws too. */
export const gatewayConfigOnRuleErrorThatThrows: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {
    inputRules: [throwingInputRule],
    onRuleError: (): void => {
      throw new Error(HANDLER_FAILURE_MESSAGE);
    },
  },
};
