import {
  IAIGatewayConfig,
  IIssue,
  IInputRule,
  EIssueSeverity,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

const OFF_TOPIC = /\b(furniture|cupboards?)\b/i;

/** Topic filter: the shop sells no furniture, so such questions are rejected before the model call. No model is needed. */
export const noFurnitureRule: IInputRule = {
  name: "no_furniture",
  check: async ({evidence}): Promise<IIssue[]> =>
    OFF_TOPIC.test(evidence.prompt)
      ? [
        {
          code: "topic_blocked",
          message: "Furniture is not a topic of this shop",
          severity: EIssueSeverity.ERROR,
          field: "prompt",
        },
      ]
      : [],
};

/** One input rule that rejects off-topic prompts: an ERROR issue fails the call before any model call. */
export const gatewayConfigInputRuleBlocksPrompt: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {inputRules: [noFurnitureRule]},
};
