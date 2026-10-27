import {EResumeAction} from "../../human-gate";

import {
  ERunOutcomeStatus,
} from "../types";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/**
 * One step calls a terminal tool (it runs) and a tool that needs approval (the run pauses). The run was ended by the first
 * call (D86), so after the approval the final step runs without tools: the terminal tool is not offered, and runs once.
 */
test("a terminal call that ran before the pause ends the run after the resume: the final step has no tools", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("handover"), makeCall("get_invoice")]},
      {text: "A colleague takes over."},
    ],
    approvals: ["get_invoice"],
  });
  const paused = await probe.run();

  const outcome = await probe.run({
    resume: {
      messages: paused.messages,
      decisions: [{action: EResumeAction.APPROVE}],
    },
  });

  expect([paused.status, outcome.status, outcome.endedByTool, outcome.result?.text, probe.executed]).toEqual([
    ERunOutcomeStatus.PAUSED,
    ERunOutcomeStatus.DONE,
    "handover",
    "A colleague takes over.",
    ["handover", "get_invoice"],
  ]);
  expect(probe.modelCalls.map(call => call.tools.length)).toEqual([3, 0]);
});
