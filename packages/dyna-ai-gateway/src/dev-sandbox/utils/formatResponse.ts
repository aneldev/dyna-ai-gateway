import {styleText} from "node:util";

import {
  TGatewayResponse,
  EGatewayResponseKind,
  EUserQuestionMode,
  EPauseKind,
  EOutputFormat,
} from "../..";

import {colorizeJson} from "./colorizeJson";
import {renderMarkdown} from "./renderMarkdown";

/**
 * formatResponse -- the response as a chat UI would show it
 *
 * # About
 *
 * > The user's view of a `TGatewayResponse`, for the terminal.
 *
 * ANSWER: the text (Markdown rendered, or plain as asked), the structured value as JSON, the sources, the issues, the
 * token usage. PAUSED: one card per envelope: the tool call to approve, the user question with its options, the review
 * (the draft when the response carries it), the allowed actions and the expiry. FAILED: the reason and the issues.
 *
 * # Who needs it
 *
 * `printResponse` of `runChatSession`, after the response's JSON.
 */
export const formatResponse = (
  {
    response,
    outputFormat = EOutputFormat.MARKDOWN,
  }: {
    response: TGatewayResponse;
    /** The format the call asked for; MARKDOWN is rendered, PLAIN is printed as is. */
    outputFormat?: EOutputFormat;
  },
): string => {
  switch (response.kind) {
    case EGatewayResponseKind.ANSWER: {
      const {
        text,
        structured,
        citations,
        issues,
        usage,
      } = response;
      return [
        text ? renderText(text, outputFormat) : "",
        structured === undefined ? "" : colorizeJson({value: structured}),
        citations.length ? styleText("dim", `Sources: ${citations.join(", ")}`) : "",
        ...issues.map(issue => styleText("yellow", `⚠ ${issue.severity} ${issue.code}: ${issue.message}`)),
        styleText("dim", `Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out`),
      ].filter(Boolean).join("\n");
    }
    case EGatewayResponseKind.PAUSED:
      return response.envelopes.map(envelope => [
        envelope.kind === EPauseKind.TOOL_APPROVAL ? styleText("yellow", `⏸ Approve tool ${envelope.toolCall.toolName} with ${colorizeJson({value: envelope.toolCall.input})}`) : "",
        envelope.kind === EPauseKind.USER_QUESTION ? styleText("yellow", `⏸ ${envelope.userQuestions.title}`) : "",
        envelope.kind === EPauseKind.USER_QUESTION && envelope.userQuestions.description ? styleText("dim", envelope.userQuestions.description) : "",
        ...envelope.kind === EPauseKind.USER_QUESTION
          ? envelope.userQuestions.questions.map((question, index) => [
            `  ${index + 1}. ${question.text}${question.mode === EUserQuestionMode.CHECK ? " (several)" : ""}`,
            ...(question.options ?? []).map(option => `     - ${option}`),
            question.freeOption || question.mode === EUserQuestionMode.FREE_TEXT ? "     - (free text)" : "",
          ].filter(Boolean).join("\n"))
          : [],
        envelope.kind === EPauseKind.RESULT_REVIEW
          ? styleText("yellow", envelope.result ? `⏸ Review ${colorizeJson({value: envelope.result})}` : "⏸ Review (the draft is the reviewer's: getPausedRun)")
          : "",
        styleText("dim", `Allowed: ${envelope.allowed.join(", ")} · expires ${envelope.expiresAt.toISOString()}`),
      ].filter(Boolean).join("\n")).join("\n\n");
    case EGatewayResponseKind.FAILED:
      return [
        styleText("red", `✗ ${response.reason}`),
        ...response.issues.map(issue => styleText("yellow", `⚠ ${issue.severity} ${issue.code}: ${issue.message}`)),
      ].join("\n");
  }
};

/** Markdown rendered for the terminal; PLAIN as it is. */
const renderText = (text: string, outputFormat: EOutputFormat): string =>
  outputFormat === EOutputFormat.MARKDOWN ? renderMarkdown({markdown: text}) : text;
