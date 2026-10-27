import {
  IUserAnswer,
  IUserQuestion,
} from "../../..";

/** One answer per question, every question answered with the same text: picked when it is an option, typed otherwise. */
export const answerEveryQuestionWith = (questions: IUserQuestion[], text: string): IUserAnswer[] =>
  questions.map(question => {
    const isOption = (question.options ?? []).includes(text);
    return {
      question: question.text,
      selected: isOption ? [text] : [],
      ...isOption ? {} : {freeText: text},
    };
  });
