import {IToolCallPart} from "../../../contracts";

import {
  ASK_USER_QUESTION_TOOL_NAME,
  askUserQuestionInputSchema,
} from "../makeAskUserQuestionTool";
import {
  TPauseEnvelopeDraft,
  EPauseKind,
  EResumeAction,
} from "../types";

/**
 * The envelope of a paused run from the tool call that paused it (D62): an `ask_user_question` call is a USER_QUESTION with the call's input
 * as the questions, any other call is a TOOL_APPROVAL that carries the policy's `rejectionText` and `reasonCode` for the call (D87). An `ask_user_question`
 * input the schema rejects pauses as an approval, so the human sees what the model asked for.
 */
export const makePauseEnvelopeDraft = (
  {
    toolCall,
    rejectionText,
    reasonCode,
  }: {
    toolCall: IToolCallPart;
    /** The policy's text for a rejection of this call; omitted = the default. */
    rejectionText?: string;
    /** The policy's code for why this call waits for a human; omitted = none. */
    reasonCode?: string;
  },
): TPauseEnvelopeDraft => {
  if (toolCall.toolName === ASK_USER_QUESTION_TOOL_NAME) {
    const parsed = askUserQuestionInputSchema.safeParse(toolCall.input);
    if (parsed.success) {
      return {
        kind: EPauseKind.USER_QUESTION,
        callId: toolCall.callId,
        userQuestions: parsed.data,
        allowed: [EResumeAction.ANSWER],
      };
    }
  }
  return {
    kind: EPauseKind.TOOL_APPROVAL,
    callId: toolCall.callId,
    toolCall,
    ...rejectionText === undefined ? {} : {rejectionText},
    ...reasonCode === undefined ? {} : {reasonCode},
    allowed: [EResumeAction.APPROVE, EResumeAction.EDIT, EResumeAction.REJECT],
  };
};
