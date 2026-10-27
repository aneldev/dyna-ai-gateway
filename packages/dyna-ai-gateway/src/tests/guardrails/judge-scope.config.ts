import {
  IAIGatewayConfig,
  IIssue,
  IInputRule,
  IModelResult,
  EFinishReason,
} from "../..";

import {openAiModel} from "../internal/samples/models";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Scope rule: a judge (a model call) decides whether the prompt stays on topic. What the judge answers, the test scripts. */
export const scopeJudgeRule: IInputRule = {
  name: "scope",
  check: ({judge}): Promise<IIssue[]> => judge({
    instruction: "Report one issue with code `out_of_scope` and severity `error` when the prompt is not about invoices.",
    fileFilter: () => false,
  }),
};

/** What the scripted model answers to a judge call: a verdict in the judge's shape, or any text when `structured` is overridden. */
export const judgeVerdict = (issues: IIssue[], overrides: Partial<IModelResult> = {}): IModelResult => ({
  modelId: openAiModel.id,
  text: "",
  structured: {issues},
  toolCalls: [],
  finishReason: EFinishReason.STOP,
  usage: {
    inputTokens: 20,
    outputTokens: 5,
  },
  latencyMs: 3,
  traceId: "trace-judge",
  ...overrides,
});

/** What the scripted model answers to the main call, once the judge let the prompt through. */
export const modelAnswer = (text: string): IModelResult => judgeVerdict([], {
  text,
  structured: undefined,
  traceId: "trace-chat",
});

/** One judge rule on the prompt; no tools, no other rules. */
export const gatewayConfigJudgeScope: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {inputRules: [scopeJudgeRule]},
};
