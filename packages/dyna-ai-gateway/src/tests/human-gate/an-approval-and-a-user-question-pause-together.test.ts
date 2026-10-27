import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EPauseKind,
  EResumeAction,
} from "../..";
import {ASK_USER_QUESTION_TOOL_NAME} from "../../internal";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {refundTool} from "../internal/samples/tools";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  answerScreenings,
  gatewayConfigParallelApprovals,
} from "./parallel-approvals.config";
import {whichInvoiceQuestions} from "./user-question.config";

/**
 * One step asks for a refund that needs approval and a user question: one pause, a TOOL_APPROVAL and a USER_QUESTION envelope
 * (D102). The resume carries EDIT for the refund and ANSWER for the question; the free text of the answer goes through the input
 * rules once (D71), the edited amount is what runs, and the answers reach the thread as the question's result.
 */
test("an approval and a user question pause together; EDIT and ANSWER resume them in one call", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigParallelApprovals, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCalls: [
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-1",
        toolName: refundTool.name,
        input: {amount: 500},
      },
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-2",
        toolName: ASK_USER_QUESTION_TOOL_NAME,
        input: whichInvoiceQuestions,
      },
    ],
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 on the overdue invoice",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5376681234525,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const screeningsBefore = answerScreenings.count;

  llmClient.enqueueRunStep({text: "Refunded 150 on invoice 4522."});
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [
      {
        callId: "call-1",
        action: EResumeAction.EDIT,
        editedInput: {amount: 150},
      },
      {
        callId: "call-2",
        action: EResumeAction.ANSWER,
        answers: [{
          question: "Pick the invoice",
          selected: [],
          freeText: "The second one, 4522",
        }],
      },
    ],
  }).response;

  const results = await loadToolResults({
    config: gatewayConfigParallelApprovals,
    threadId: paused.threadId,
  });
  expect([
    paused.envelopes.map(envelope => envelope.kind),
    response.kind,
    answerScreenings.count - screeningsBefore,
    results.map(part => [part.callId, part.output]),
  ]).toEqual([
    [EPauseKind.TOOL_APPROVAL, EPauseKind.USER_QUESTION],
    EGatewayResponseKind.ANSWER,
    1,
    [
      ["call-1", {refunded: 150}],
      ["call-2", {
        answers: [{
          question: "Pick the invoice",
          selected: [],
          freeText: "The second one, 4522",
        }],
      }],
    ],
  ]);
});
