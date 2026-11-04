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
 * askPauseDecision -- one decision for one card of a paused run, typed by the developer
 *
 * # About
 *
 * > The envelope's allowed actions as lowercase words; repeats until one of them is typed.
 *
 * `approve`; `edit <json>`, the whole new tool input (`edit {"amount": 200}`), or on a reviewed answer `edit <text>`, the new
 * answer; `reject [reason]`; `answer <text> | <text> | …` for a user question, one text per question in order, a text
 * equal to an option is a pick, anything else is free text. Returns null when the input closed (Ctrl+D, end of a pipe).
 * The `callId` is not set here: the caller adds it from the envelope.
 *
 * # Who needs it
 *
 * `settlePauses` of `runChatSession`, once per envelope of a PAUSED response.
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

/**
 * One answer per question: the texts split on `|`, in the questions' order; a missing text is an empty answer.
 * A text that equals an option (several, comma-separated) is selected; any other text is free text.
 */
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
