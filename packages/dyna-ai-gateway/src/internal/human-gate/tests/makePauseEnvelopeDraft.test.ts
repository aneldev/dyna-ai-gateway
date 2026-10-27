import {
  IToolCallPart,
  EPartKind,
} from "../../../contracts";

import {ASK_USER_QUESTION_TOOL_NAME} from "../makeAskUserQuestionTool";
import {
  EUserQuestionMode,
  EPauseKind,
  EResumeAction,
} from "../types";
import {makePauseEnvelopeDraft} from "../utils/makePauseEnvelopeDraft";

const userQuestions = {
  title: "Which invoice?",
  questions: [{
    text: "Pick the invoice",
    mode: EUserQuestionMode.RADIO,
    options: ["4521", "4522"],
  }],
};

const makeCall = (toolName: string, input: unknown): IToolCallPart => ({
  kind: EPartKind.TOOL_CALL,
  callId: "call-1",
  toolName,
  input,
});

describe("makePauseEnvelopeDraft (D62)", () => {
  test("an ask_user_question call becomes a USER_QUESTION with the call's id that allows ANSWER only", () => {
    expect(makePauseEnvelopeDraft({toolCall: makeCall(ASK_USER_QUESTION_TOOL_NAME, userQuestions)})).toEqual({
      kind: EPauseKind.USER_QUESTION,
      callId: "call-1",
      userQuestions,
      allowed: [EResumeAction.ANSWER],
    });
  });

  test("any other call becomes a TOOL_APPROVAL with the call and its id", () => {
    const toolCall = makeCall("refund", {amount: 500});
    expect(makePauseEnvelopeDraft({toolCall})).toEqual({
      kind: EPauseKind.TOOL_APPROVAL,
      callId: "call-1",
      toolCall,
      allowed: [EResumeAction.APPROVE, EResumeAction.EDIT, EResumeAction.REJECT],
    });
  });

  test("an ask_user_question call whose input the schema rejects pauses as a TOOL_APPROVAL", () => {
    const toolCall = makeCall(ASK_USER_QUESTION_TOOL_NAME, {title: "no questions"});
    expect(makePauseEnvelopeDraft({toolCall}).kind).toBe(EPauseKind.TOOL_APPROVAL);
  });
});
