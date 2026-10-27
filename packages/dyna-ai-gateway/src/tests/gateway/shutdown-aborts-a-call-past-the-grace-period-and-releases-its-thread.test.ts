import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  EThreadStatus,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigShutdown} from "./shutdown.config";

/**
 * A call still running when the grace period passes is aborted through its call signal (D96, D90): it answers FAILED with
 * `call_aborted` and a reason that names the shutdown, its thread is open again with no lease, its user turn is kept, and the
 * shutdown settles once the call is closed.
 */
test("shutdown aborts a call past the grace period: FAILED call_aborted, the thread open and unleased, the turn kept", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigShutdown, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    text: "An answer that takes too long.",
    delayMs: 10_000,
  });
  const startedAt = Date.now();

  const pending = gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Tell me a long story",
    kbFilters: noKb,
  }).response;
  const stopped = gateway.shutdown({timeoutMs: 100});
  const [response] = await Promise.all([pending, stopped]);
  const thread = await gatewayConfigShutdown.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: response.threadId ?? "",
  });
  const turns = await gatewayConfigShutdown.threadStore.repository.loadTurns({
    tenantId: sampleUserContext.tenantId,
    threadId: response.threadId ?? "",
    desc: false,
    skip: 0,
    limit: 10,
  });

  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.reason,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => issue.code),
    Date.now() - startedAt < 5_000,
    thread?.status,
    thread?.lease,
    turns.map(turn => turn.role),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    "The call was aborted: the gateway is shutting down",
    [CALL_ABORTED_ISSUE_CODE],
    true,
    EThreadStatus.OPEN,
    null,
    [ETurnRole.USER],
  ]);
});
