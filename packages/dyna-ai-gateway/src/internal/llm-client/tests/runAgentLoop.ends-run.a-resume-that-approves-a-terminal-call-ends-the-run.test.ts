import {
  EResumeAction,
} from "../../human-gate";

import {
  EMessageRole,
  ERunOutcomeStatus,
  ELLMClientEventKind,
} from "../types";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** The pause and the resume share the execute path: an approved terminal call ends the run like a fresh one (D86). */
test("APPROVE of a paused terminal call ends the run: the final step runs without tools", async () => {
  const probe = makeLoopProbe({
    script: [{text: "A colleague takes over."}],
    approvals: ["handover"],
  });
  const outcome = await probe.run({
    resume: {
      messages: [{
        role: EMessageRole.ASSISTANT,
        parts: [makeCall("handover")],
      }],
      decisions: [{action: EResumeAction.APPROVE}],
    },
  });

  expect([outcome.status, outcome.endedByTool, outcome.result?.text, probe.executed]).toEqual([ERunOutcomeStatus.DONE, "handover", "A colleague takes over.", ["handover"]]);
  expect(probe.modelCalls.map(call => call.tools)).toEqual([[]]);
  expect(probe.eventKinds()).toEqual([
    ELLMClientEventKind.TOOL_RESULT,
    ELLMClientEventKind.RUN_ENDED_BY_TOOL,
    ELLMClientEventKind.STEP_END,
    ELLMClientEventKind.DONE,
  ]);
});
