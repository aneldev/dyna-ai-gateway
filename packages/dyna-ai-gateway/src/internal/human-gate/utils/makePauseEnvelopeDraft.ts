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
 * makePauseEnvelopeDraft -- the card of one tool call that paused the run
 *
 * # About
 *
 * > A question to the user, or a call for a human to approve.
 *
 * An `ask_user_question` call whose input passes the schema is a USER_QUESTION envelope with the input as the questions
 * and ANSWER as the only allowed action (D62). Any other call is a TOOL_APPROVAL envelope with the call, the policy's
 * `rejectionText` and `reasonCode` for it (D87) and APPROVE, EDIT, REJECT allowed. An `ask_user_question` input the schema
 * rejects pauses as an approval, so the human sees what the model asked for.
 *
 * # Who needs it
 *
 * `settleRun`, once per pending tool call of the step, before `HumanGate.pause`.
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
