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
 * A file deleted while its run waits for a human is gone for good (the run keeps no copy). The resume still goes on: the
 * model reads a note in place of the file, so it knows the file is no longer there.
 */
test("a file deleted while the run was paused reaches the resumed model as a note, and the run answers", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigPausedRunWithAFile, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const file = await gateway.uploadFile({
    userContext: sampleUserContext,
    bytes: new Uint8Array([137, 80, 78, 71]),
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
      code: 5377210486149,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  await gateway.removeFilesByUser({
    tenantId: sampleUserContext.tenantId,
    userId: sampleUserContext.userId,
  });

  const answer = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;

  const userParts: TMessagePart[] = llmClient.runCalls.at(-1)?.resume?.messages[0].parts ?? [];
  expect([answer.kind, userParts.filter(part => part.kind !== EPartKind.TEXT || part.text.startsWith("[The file"))]).toEqual([
    EGatewayResponseKind.ANSWER,
    [{
      kind: EPartKind.TEXT,
      text: "[The file receipt.png (image/png) was deleted and is no longer available]",
    }],
  ]);
});
