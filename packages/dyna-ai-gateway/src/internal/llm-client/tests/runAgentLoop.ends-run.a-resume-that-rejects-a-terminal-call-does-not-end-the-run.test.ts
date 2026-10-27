import {
  EResumeAction,
} from "../../human-gate";

import {
  EMessageRole,
} from "../types";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** A rejected call did not run: nothing ended; the loop continues with the step's tools. */
test("REJECT of a paused terminal call does not end the run", async () => {
  const probe = makeLoopProbe({
    script: [{text: "Understood, I stay with you."}],
    approvals: ["handover"],
  });
  const outcome = await probe.run({
    resume: {
      messages: [{
        role: EMessageRole.ASSISTANT,
        parts: [makeCall("handover")],
      }],
      decisions: [{
        action: EResumeAction.REJECT,
        text: "Not now",
      }],
    },
  });

  expect([outcome.endedByTool, probe.executed]).toEqual([undefined, []]);
  expect(probe.modelCalls[0]?.tools.length).toBe(3);
});
