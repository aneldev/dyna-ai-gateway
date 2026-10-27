import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  ELLMClientEventKind,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSlowModel} from "./slow-model.config";

/**
 * The caller presses "stop" while the model is still writing (the scripted answer takes 10 s; the stop is pressed the moment the
 * model is called): the call is FAILED at once, the user turn stays and no answer is stored, and the call's `events` end without
 * a DONE.
 */
test("an ask aborted during the model call is FAILED at once, stores no answer, and its events end", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSlowModel, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const controller = new AbortController();
  llmClient.enqueueComplete(
    makeModelResult({
      modelId: openAiModel.id,
      text: "A long answer.",
    }),
    undefined,
    {
      delayMs: 10_000,
      onCalled: (): void => controller.abort(),
    },
  );
  const startedAt = Date.now();

  const {
    events,
    response: pending,
  } = gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Tell me a long story",
    kbFilters: noKb,
    abortSignal: controller.signal,
  });
  const kinds: ELLMClientEventKind[] = [];
  for await (const event of events) kinds.push(event.kind);
  const response = await pending;

  const turns = await gatewayConfigSlowModel.threadStore.repository.loadTurns({
    tenantId: sampleUserContext.tenantId,
    threadId: response.threadId ?? "",
    desc: false,
    skip: 0,
    limit: 10,
  });
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => issue.code),
    Date.now() - startedAt < 5_000,
    kinds,
    turns.map(turn => turn.role),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [CALL_ABORTED_ISSUE_CODE],
    true,
    [],
    [ETurnRole.USER],
  ]);
});
