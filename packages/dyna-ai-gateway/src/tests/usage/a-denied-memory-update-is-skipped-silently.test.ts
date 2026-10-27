import {
  AIGateway,
  EGatewayResponseKind,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigDenyMemory,
  usageAdapterDenyingMemory,
} from "./denied.config";

/**
 * The app says no to the thread memory's helper call, after the answer: the answer stands, the memory is left as it was for a
 * later turn, nothing is logged as an internal error and nothing is reported for the refused call.
 */
test("a memory helper call the app refuses is skipped silently; the answer stands and the memory waits", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDenyMemory, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello.",
  }));
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

  const response = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hi",
    kbFilters: noKb,
  }).response;
  await gateway.whenIdle();

  const errorLogs = consoleError.mock.calls.length;
  consoleError.mockRestore();
  const thread = await gatewayConfigDenyMemory.threadStore.repository.loadThread({
    tenantId: sampleUserContext.tenantId,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    thread?.workingMemory.updatedAtTurn,
    errorLogs,
    usageAdapterDenyingMemory.checkCalls.map(call => call.kind),
    usageAdapterDenyingMemory.addUsageCalls.map(call => call.kind),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    0,
    0,
    [ETraceKind.CHAT, ETraceKind.MEMORY_WORKING],
    [ETraceKind.CHAT],
  ]);
});
