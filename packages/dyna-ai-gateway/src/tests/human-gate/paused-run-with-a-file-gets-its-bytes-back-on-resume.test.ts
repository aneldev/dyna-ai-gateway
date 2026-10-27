import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  TMessagePart,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigPausedRunWithAFile,
  refundOnApprovalTool,
} from "./paused-run-with-a-file.config";

/**
 * A paused run keeps no copy of an uploaded file: its stored messages hold the file part with empty bytes, and the resume
 * loads the bytes again from the FileStore, so the model of the resumed step sees the file as before.
 */
test("a paused run stores the file without its bytes; the resume sends the bytes to the model again", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigPausedRunWithAFile, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const file = await gateway.uploadFile({
    userContext: sampleUserContext,
    bytes,
    mime: "image/png",
    name: "receipt.png",
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: refundOnApprovalTool.name,
      input: {amount: 20},
    },
  });
  llmClient.enqueueRunStep({text: "Refunded."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund this receipt",
    files: [file],
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5377210486141,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const {
    runId,
    pauseId,
  } = paused.envelopes[0];
  const stored = await gatewayConfigPausedRunWithAFile.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId,
  });

  const answer = await gateway.resume({
    userContext: sampleUserContext,
    runId,
    pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;

  const fileParts = (parts: TMessagePart[] = []): TMessagePart[] => parts.filter(part => part.kind === EPartKind.INLINE_FILE);
  const storedFile = fileParts(stored?.messages.flatMap(message => message.parts));
  const resumedFile = fileParts(llmClient.runCalls.at(-1)?.resume?.messages.flatMap(message => message.parts));
  const expected = (sent: Uint8Array): TMessagePart => ({
    kind: EPartKind.INLINE_FILE,
    mime: "image/png",
    bytes: sent,
    name: "receipt.png",
    fileId: file.id,
    size: bytes.byteLength,
  });
  expect([answer.kind, storedFile, resumedFile]).toEqual([
    EGatewayResponseKind.ANSWER,
    [expected(new Uint8Array(0))],
    [expected(bytes)],
  ]);
});
