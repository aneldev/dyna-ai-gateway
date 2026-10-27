import {
  IUserAnswer,
  EGatewayResponseKind,
  EModelProvider,
  EPauseKind,
  EResumeAction,
  AIGateway,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigAskUserQuestion} from "./ask-user-question.real.config";

/**
 * The model asks the user (D62) on a real provider. A real model is not deterministic; the test is stable because the request
 * leaves it one path: the profile names two overdue invoices and forbids guessing and asking in text, the prompt names none, and
 * `ask_user_question` is the only tool. The assertions are structural (pause kind, response kind) plus the one token the user chose.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */

const CHOSEN_INVOICE = "4521";

/** Picks the chosen invoice where it is an option, types it otherwise. */
const answerWithChosenInvoice = (questions: Array<{ text: string; options?: string[] }>): IUserAnswer[] =>
  questions.map(question => {
    const option = (question.options ?? []).find(candidate => candidate.includes(CHOSEN_INVOICE));
    return {
      question: question.text,
      selected: option ? [option] : [],
      ...option ? {} : {freeText: `Invoice ${CHOSEN_INVOICE}`},
    };
  });

describeWithProvider(EModelProvider.OPENAI)("AIGateway — the model asks the user, real provider", () => {
  test("an ambiguous request pauses with a user question; answered, the run finishes with the chosen invoice", async () => {
    const gateway = new AIGateway(gatewayConfigAskUserQuestion);

    const paused = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Refund the overdue invoice.",
      kbFilters: noKb,
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected PAUSED, got ${paused.kind}: ${JSON.stringify(paused)}`);
    if (paused.envelopes[0].kind !== EPauseKind.USER_QUESTION) throw new Error(`Expected a USER_QUESTION pause, got ${paused.envelopes[0].kind}`);

    const response = await gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{
        action: EResumeAction.ANSWER,
        answers: answerWithChosenInvoice(paused.envelopes[0].userQuestions.questions),
      }],
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    expect([paused.envelopes[0].userQuestions.questions.length > 0, response.text]).toEqual([true, expect.stringContaining(CHOSEN_INVOICE)]);
  });
});
