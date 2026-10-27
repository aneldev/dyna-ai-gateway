import {
  AIGateway,
  EGatewayResponseKind,
  ELLMClientEventKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigTerminalTools,
  handoverToAgentTool,
} from "./terminal-tools.config";

/**
 * The model hands the customer over; the tool has `endsRun: true` (D86). The run ends after that step: the model gets one last
 * step to phrase the closing sentence, the stream says RUN_ENDED_BY_TOOL before that text, and the answer names the tool.
 */
test("a tool with endsRun ends the run: the answer carries the closing text and endedByTool, the stream announces it before the text", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigTerminalTools, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCalls: [{
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: handoverToAgentTool.name,
      input: {reason: "The customer asked for a human"},
    }],
  });
  llmClient.enqueueRunStep({text: "A colleague takes over from here."});

  const call = gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "I want to talk to a human.",
    kbFilters: noKb,
  });
  const kinds: ELLMClientEventKind[] = [];
  for await (const event of call.events) kinds.push(event.kind);
  const response = await call.response;

  if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected an answer, got ${response.kind}`);
  expect([response.text, response.endedByTool]).toEqual(["A colleague takes over from here.", handoverToAgentTool.name]);
  expect(kinds.indexOf(ELLMClientEventKind.RUN_ENDED_BY_TOOL)).toBeGreaterThan(kinds.indexOf(ELLMClientEventKind.TOOL_RESULT));
  expect(kinds.indexOf(ELLMClientEventKind.RUN_ENDED_BY_TOOL)).toBeLessThan(kinds.lastIndexOf(ELLMClientEventKind.TEXT_DELTA));
  expect(kinds[kinds.length - 1]).toBe(ELLMClientEventKind.DONE);
});
