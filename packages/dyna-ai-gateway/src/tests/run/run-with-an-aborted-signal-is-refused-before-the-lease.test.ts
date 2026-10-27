import {dynaError} from "dyna-error";

import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigBusyThread} from "./busy-thread.config";

/**
 * The thread is busy (another call holds its lease, D77) and the caller's signal is already aborted: the call is answered FAILED
 * before the lease is taken, not refused with the 409 a live call would get; nothing is stored, the model is never called.
 */
test("a run with an already-aborted signal is FAILED before the thread's lease, even when the thread is busy", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigBusyThread, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "First.",
  }));
  const first = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
  }).response;
  if (first.kind !== EGatewayResponseKind.ANSWER) {
    throw dynaError({
      code: 5376412760063,
      message: `Test setup: expected ANSWER, got ${first.kind}`,
      data: {first},
    });
  }
  const now = new Date();
  const held = await gatewayConfigBusyThread.threadStore.repository.acquireLease({
    tenantId: sampleUserContext.tenantId,
    threadId: first.threadId,
    token: "another-call",
    expiresAt: new Date(now.getTime() + 60_000),
    now,
  });

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    threadId: first.threadId,
    prompt: "Again",
    kbFilters: noKb,
    abortSignal: AbortSignal.abort(),
  }).response;

  const turns = await gatewayConfigBusyThread.threadStore.repository.loadTurns({
    tenantId: sampleUserContext.tenantId,
    threadId: first.threadId,
    desc: false,
    skip: 0,
    limit: 10,
  });
  expect([
    held,
    response.kind,
    response.threadId,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => issue.code),
    turns.length,
  ]).toEqual([
    true,
    EGatewayResponseKind.FAILED,
    first.threadId,
    [CALL_ABORTED_ISSUE_CODE],
    2,
  ]);
});
