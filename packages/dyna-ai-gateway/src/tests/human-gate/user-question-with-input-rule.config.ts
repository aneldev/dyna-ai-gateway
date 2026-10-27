import {IAIGatewayConfig} from "../..";

import {noFurnitureRule} from "../guardrails/input-rule-blocks-prompt.config";

import {gatewayConfigUserQuestion} from "./user-question.config";

/** The user-question tool switched on, plus the topic filter of the guardrails tests: what it rejects as a prompt it rejects as an answer. */
export const gatewayConfigUserQuestionWithInputRule: IAIGatewayConfig = {
  ...gatewayConfigUserQuestion,
  guardrails: {inputRules: [noFurnitureRule]},
};
