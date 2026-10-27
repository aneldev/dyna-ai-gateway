import {
  EMessageRole,
  ERunOutcomeStatus,
  EFinishReason,
  ELLMClientEventKind,
} from "../types";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** The model asks for the terminal tool; it runs; the model gets one last step with no tools and phrases the answer (D86). */
test("a terminal tool ends the run after its step: one final model call without tools, DONE with the model's text and endedByTool", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("handover")]},
      {text: "A colleague takes over from here."},
    ],
  });
  const outcome = await probe.run();

  expect([outcome.status, outcome.result?.finishReason, outcome.result?.text, outcome.endedByTool, outcome.steps])
    .toEqual([ERunOutcomeStatus.DONE, EFinishReason.STOP, "A colleague takes over from here.", "handover", 2]);
  expect(probe.modelCalls.map(call => call.tools.map(tool => tool.name))).toEqual([["handover", "log_event", "get_invoice"], []]);
  expect(outcome.messages.map(message => message.role)).toEqual([EMessageRole.ASSISTANT, EMessageRole.TOOL, EMessageRole.ASSISTANT]);
  expect(probe.eventKinds()).toEqual([
    ELLMClientEventKind.TOOL_REQUEST,
    ELLMClientEventKind.TOOL_RESULT,
    ELLMClientEventKind.STEP_END,
    ELLMClientEventKind.RUN_ENDED_BY_TOOL,
    ELLMClientEventKind.STEP_END,
    ELLMClientEventKind.DONE,
  ]);
  expect(probe.events.find(event => event.kind === ELLMClientEventKind.RUN_ENDED_BY_TOOL)?.toolCall?.toolName).toBe("handover");
});
