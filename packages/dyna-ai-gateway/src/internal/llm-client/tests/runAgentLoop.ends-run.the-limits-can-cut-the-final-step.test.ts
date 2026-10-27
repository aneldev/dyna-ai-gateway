import {
  ERunOutcomeStatus,
  EFinishReason,
  ELLMClientEventKind,
} from "../types";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** The final step is an ordinary step for the limits: at maxSteps the run stops as it would without it, still naming the tool. */
test("maxSteps reached before the final step: DONE with LENGTH and endedByTool, no further model call", async () => {
  const probe = makeLoopProbe({script: [{toolCalls: [makeCall("handover")]}]});
  const outcome = await probe.run({maxSteps: 1});

  expect([outcome.status, outcome.result?.finishReason, outcome.endedByTool, probe.modelCalls.length])
    .toEqual([ERunOutcomeStatus.DONE, EFinishReason.LENGTH, "handover", 1]);
  expect(probe.eventKinds()).toEqual([
    ELLMClientEventKind.TOOL_REQUEST,
    ELLMClientEventKind.TOOL_RESULT,
    ELLMClientEventKind.STEP_END,
    ELLMClientEventKind.RUN_ENDED_BY_TOOL,
    ELLMClientEventKind.DONE,
  ]);
});
