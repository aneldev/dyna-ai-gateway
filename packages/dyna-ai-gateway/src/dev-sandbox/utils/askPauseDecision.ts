import {
  IUserQuestions,
  IUserAnswer,
  IResumeDecision,
  TPauseEnvelope,
  EPauseKind,
  EResumeAction,
} from "../..";

import {ILineReader} from "./createLineReader";

/**
 * Asks the developer what to do with a paused run: `approve`, `edit <json>` (the whole new tool input, e.g. `edit {"amount": 200}`;
 * on a reviewed answer `edit <text>` is the new answer text), `reject [reason]`, or `answer <text> | <text> | …` for a user
 * question (one text per question, in order, separated by `|`; a text equal to an option is a pick, anything else is free text).
 * Repeats until the input is one of the envelope's allowed actions. Returns null when the input closed.
 */
export const askPauseDecision = async (
  {
    reader,
    envelope,
  }: {
    reader: ILineReader;
    envelope: TPauseEnvelope;
  },
): Promise<IResumeDecision | null> => {
  // The human types the action as a lowercase word; the enum value is its uppercase
  const typedActions = envelope.allowed.map(action => action.toLowerCase());
  for (;;) {
    const line = await reader.question(`decision (${typedActions.join(" | ")}) > `);
    if (line === null) return null;
    const trimmed = line.trim();
    const [word = ""] = trimmed.split(/\s+/, 1);
    const action = word.toUpperCase();
    const text = trimmed.slice(word.length).trim();
    const isAllowed = (candidate: string): candidate is EResumeAction => envelope.allowed.includes(candidate as EResumeAction);
    if (!isAllowed(action)) {
      console.log(`> Type one of: ${typedActions.join(", ")}`);
      continue;
    }
    if (action === EResumeAction.EDIT) {
      const editedInput =
        envelope.kind === EPauseKind.RESULT_REVIEW
          ? text || undefined
          : parseEditedInput(text);
      if (editedInput === undefined) {
        console.log(
          envelope.kind === EPauseKind.RESULT_REVIEW
            ? "> edit needs the new answer text, e.g.: edit Your order arrives Friday."
            : '> edit needs the whole new tool input as JSON, e.g.: edit {"amount": 200}',
        );
        continue;
      }
      return {
        action,
        editedInput,
      };
    }
    if (
      action === EResumeAction.ANSWER &&
      envelope.kind === EPauseKind.USER_QUESTION
    ) {
      return {
        action,
        answers: parseAnswers({
          userQuestions: envelope.userQuestions,
          text,
        }),
      };
    }
    return text ? {
      action,
      text,
    } : {action};
  }
};

/** The text after `edit` as JSON; undefined when it is empty or not valid JSON. */
const parseEditedInput = (text: string): unknown => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  }
  catch {
    return undefined;
  }
};

/** One answer per question: the texts split on `|`; a text that equals an option is selected, any other text is free text. */
const parseAnswers = ({
  userQuestions,
  text,
}: {
  userQuestions: IUserQuestions;
  text: string;
}): IUserAnswer[] => {
  const texts = text.split("|").map(part => part.trim());
  return userQuestions.questions.map((question, index) => {
    const answer = texts[index] ?? "";
    const options = question.options ?? [];
    const selected = answer
      .split(",")
      .map(part => part.trim())
      .filter(part => options.includes(part));
    return {
      question: question.text,
      selected,
      ...selected.length === 0 && answer ? {freeText: answer} : {},
    };
  });
};
