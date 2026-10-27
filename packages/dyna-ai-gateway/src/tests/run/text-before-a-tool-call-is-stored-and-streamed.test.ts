import {
  AIGateway,
  ELLMClientEventKind,
  EPartKind,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {getCurrentTimeTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigParallelTools} from "./parallel-tools.config";

/**
 * The model writes text and asks for a tool in the same step ("Let me check…", then the call), as real models do. The text is
 * streamed before the tool request, and the assistant turn stores the text next to the tool call.
 */
test("text the model writes before a tool call is streamed first and stored with the call", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigParallelTools, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    text: "Let me check the time.",
    toolCalls: [{
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: getCurrentTimeTool.name,
      input: {},
    }],
  });
  llmClient.enqueueRunStep({text: "It is now."});

  const call = gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What time is it?",
    kbFilters: noKb,
  });
  const kinds: ELLMClientEventKind[] = [];
  for await (const event of call.events) kinds.push(event.kind);
  const response = await call.response;

  const turns = await gatewayConfigParallelTools.threadStore.repository.loadTurns({
    tenantId: sampleUser.tenantId,
    threadId: response.threadId ?? "",
    desc: false,
    skip: 0,
    limit: 10,
  });
  const firstAssistantTurn = turns.find(turn => turn.role === ETurnRole.ASSISTANT);
  expect([
    kinds.indexOf(ELLMClientEventKind.TEXT_DELTA) < kinds.indexOf(ELLMClientEventKind.TOOL_REQUEST),
    firstAssistantTurn?.parts.map(part => part.kind),
  ]).toEqual([
    true,
    [EPartKind.TEXT, EPartKind.TOOL_CALL],
  ]);
});
