import {dynaError} from "dyna-error";

import {
  IUserAnswer,
  IUserQuestions,
  EUserQuestionMode,
} from "../types";

/**
 * validateAnswers -- the answers of an ANSWER decision, checked against the questions the card asked
 *
 * # About
 *
 * > The client sends what the user picked or typed; the card says what could be picked.
 *
 * One answer per question, in the order of the questions. `selected` must be options of its question, at most one on a
 * RADIO and none on a FREE_TEXT question; `freeText` only where the question takes it (FREE_TEXT, or `freeOption`). The
 * question's text comes from the card, never from the client. Anything else is a 400, before the answer is screened and
 * before the run leaves PAUSED.
 *
 * # Who needs it
 *
 * `HumanGate.matchDecisions`, for every ANSWER to a USER_QUESTION card: the answers it returns are what the screen, the
 * model and the stored turns get.
 */
export const validateAnswers = (
  {
    runId,
    callId,
    userQuestions,
    answers = [],
  }: {
    runId: string;
    callId: string;
    userQuestions: IUserQuestions;
    answers?: IUserAnswer[];
  },
): IUserAnswer[] => {
  const {questions} = userQuestions;
  if (answers.length !== questions.length) {
    throw dynaError({
      code: 5377210486223,
      status: 400,
      message: `HumanGate: the answer to [${callId}] of run [${runId}] has ${answers.length} answers for ${questions.length} questions`,
      data: {
        runId,
        callId,
        answers: answers.length,
        questions: questions.length,
      },
    });
  }
  return questions.map((question, index): IUserAnswer => {
    const answer = answers[index];
    const selected = answer?.selected ?? [];
    const options = question.mode === EUserQuestionMode.FREE_TEXT ? [] : question.options ?? [];
    const notOffered = selected.filter(option => !options.includes(option));
    if (notOffered.length > 0 || new Set(selected).size !== selected.length) {
      throw dynaError({
        code: 5377210486227,
        status: 400,
        message: `HumanGate: the answer to question ${index + 1} of [${callId}] picks what the question does not offer, or one option twice`,
        data: {
          runId,
          callId,
          question: index,
          notOffered,
        },
      });
    }
    if (question.mode === EUserQuestionMode.RADIO && selected.length > 1) {
      throw dynaError({
        code: 5377210486229,
        status: 400,
        message: `HumanGate: question ${index + 1} of [${callId}] takes one option, the answer picks ${selected.length}`,
        data: {
          runId,
          callId,
          question: index,
        },
      });
    }
    const freeText = answer?.freeText?.trim();
    if (freeText && question.mode !== EUserQuestionMode.FREE_TEXT && !question.freeOption) {
      throw dynaError({
        code: 5377210486233,
        status: 400,
        message: `HumanGate: question ${index + 1} of [${callId}] takes no typed answer`,
        data: {
          runId,
          callId,
          question: index,
        },
      });
    }
    return {
      question: question.text,
      selected: [...selected],
      ...freeText ? {freeText} : {},
    };
  });
};
