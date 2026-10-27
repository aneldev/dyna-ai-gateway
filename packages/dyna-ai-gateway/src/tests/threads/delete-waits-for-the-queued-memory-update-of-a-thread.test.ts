import {
  AIGateway,
  ETraceKind,
  EUserMemoryFactOp,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigDelete} from "./delete.config";

/**
 * The memory update of an answer runs in the background after the response. A `delete` right after the answer waits for
 * it, so nothing of the thread is written back once it is gone: the thread stays deleted and no trace entry of it survives (D119, D17).
 */
test("delete waits for the queued memory update of the thread, so nothing is written after the delete", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDelete, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const {
    tenantId,
    userId,
  } = sampleUserContext;
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello.",
  }));
  let memoryStarted = false;
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    structured: {
      facts: [{
        key: "drink",
        value: "tea",
        op: EUserMemoryFactOp.SET,
      }],
    },
  }), ETraceKind.MEMORY_USER, {
    delayMs: 200,
    onCalled: (): void => {
      memoryStarted = true;
    },
  });
  const answer = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "I like tea",
    kbFilters: noKb,
  }).response;

  const deleted = await gateway.delete({
    tenantId,
    threadIds: [answer.threadId ?? ""],
  });

  const thread = await gatewayConfigDelete.threadStore.repository.loadThread({
    tenantId,
    threadId: answer.threadId ?? "",
  });
  const traces = await gateway.trace.query({
    tenantId,
    filters: {threadId: answer.threadId ?? ""},
    skip: 0,
    limit: 10,
  });
  const facts = await gateway.getUserFacts({userContext: sampleUserContext});
  expect([
    memoryStarted,
    deleted,
    thread,
    traces,
    facts.length,
    userId,
  ]).toEqual([
    true,
    {threads: 1},
    null,
    [],
    1,
    userId,
  ]);
});
