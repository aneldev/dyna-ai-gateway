import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {refundTool} from "../internal/samples/tools";
import {makeModelResult} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigPausedRunMemory} from "./paused-run-memory.config";

const PROMPT = "I am Dennis from Vienna, refund invoice 4521";

/**
 * The user's facts are extracted from the whole run, not from its resumed part (D36): the run stores the thread's turn count
 * before its question, and the extraction after the resumed answer reads the turns from there. The run's question (turn 1)
 * is in the transcript the cheap model gets, although the resume itself started at turn 2.
 */
test("the extraction after a resumed run reads the turns from the run's start, the question included", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigPausedRunMemory, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: refundTool.name,
      input: {amount: 500},
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: PROMPT,
    kbFilters: {
      libraryIds: [],
      bookIds: [],
    },
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5379462948348,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  llmClient.enqueueRunStep({text: "Refunded."});
  llmClient.enqueueComplete(makeModelResult({structured: {facts: []}}), ETraceKind.MEMORY_USER);
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;
  await gateway.whenIdle();

  const extractions = llmClient.completeCalls.filter(call => call.meta.kind === ETraceKind.MEMORY_USER);
  const transcript = extractions
    .flatMap(call => call.request.messages)
    .flatMap(message => message.parts.map(part => part.kind === EPartKind.TEXT ? part.text : ""))
    .join("\n");
  expect([response.kind, extractions.length, transcript.includes(PROMPT), transcript.includes("Refunded.")])
    .toEqual([EGatewayResponseKind.ANSWER, 1, true, true]);
});
