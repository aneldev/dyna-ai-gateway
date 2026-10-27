import {
  IAIGatewayConfig,
  IUserAnswer,
  IUserQuestions,
  EUserQuestionMode,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** What the model asks: one radio question with a free option. */
export const whichInvoiceQuestions: IUserQuestions = {
  title: "Which invoice?",
  description: "Two invoices are overdue.",
  questions: [{
    text: "Pick the invoice",
    mode: EUserQuestionMode.RADIO,
    options: ["4521", "4522"],
    freeOption: true,
  }],
};

/** The user's answer to it. */
export const whichInvoiceAnswers: IUserAnswer[] = [{
  question: "Pick the invoice",
  selected: ["4521"],
}];

/** The built-in user-question tool switched on; no other tools. */
export const gatewayConfigUserQuestion: IAIGatewayConfig = {
  ...gatewayConfigBase,
  humanGate: {userQuestions: {enabled: true}},
};
