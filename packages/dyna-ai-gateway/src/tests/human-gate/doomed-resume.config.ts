import {
  IAIGatewayConfig,
  IInputRule,
} from "../..";

import {gatewayConfigUserQuestion} from "./user-question.config";

/** How many times the counting rule ran: the proof that a doomed resume never reaches the answer screen. */
export const screenCalls = {count: 0};

/** An input rule that passes everything and counts its calls. */
export const countingRule: IInputRule = {
  name: "counting",
  check: async () => {
    screenCalls.count += 1;
    return [];
  },
};

/** The user-question tool switched on, plus a counting input rule on the prompt and on the answers' free text (D71). */
export const gatewayConfigDoomedResume: IAIGatewayConfig = {
  ...gatewayConfigUserQuestion,
  guardrails: {inputRules: [countingRule]},
};
