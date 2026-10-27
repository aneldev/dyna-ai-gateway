import {
  IToolCallPart,
  EPartKind,
} from "../../../contracts";

import {ASK_USER_QUESTION_TOOL_NAME} from "../makeAskUserQuestionTool";
import {
  EUserQuestionMode,
  EPauseKind,
} from "../types";
import {makePauseEnvelopeDraft} from "../utils/makePauseEnvelopeDraft";

const makeCall = (toolName: string, input: unknown): IToolCallPart => ({
  kind: EPartKind.TOOL_CALL,
  callId: "call-1",
  toolName,
  input,
});

/** The policy's text for a rejection (D87) is kept with the pause of a TOOL_APPROVAL; a USER_QUESTION has no rejection, so it carries none. */
test("a TOOL_APPROVAL envelope carries the policy's rejection text; a USER_QUESTION envelope does not", () => {
  const approval = makePauseEnvelopeDraft({
    toolCall: makeCall("refund", {amount: 500}),
    rejectionText: "The refund of 500 was declined.",
  });
  const question = makePauseEnvelopeDraft({
    toolCall: makeCall(ASK_USER_QUESTION_TOOL_NAME, {
      title: "Which invoice?",
      questions: [{
        text: "Pick the invoice",
        mode: EUserQuestionMode.RADIO,
        options: ["4521", "4522"],
      }],
    }),
    rejectionText: "ignored",
  });

  expect([
    approval.kind,
    approval.kind === EPauseKind.TOOL_APPROVAL ? approval.rejectionText : null,
    question.kind,
    "rejectionText" in question,
  ]).toEqual([EPauseKind.TOOL_APPROVAL, "The refund of 500 was declined.", EPauseKind.USER_QUESTION, false]);
});
