import {EResumeAction} from "../../human-gate";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** A decision that names a call the run does not wait on is a 400: nothing runs, nothing is stored. */
test("a decision for a call that is not pending is refused with a 400", async () => {
  const first = makeLoopProbe({
    script: [{toolCalls: [makeCall("log_event")]}],
    approvals: ["log_event"],
  });
  const paused = await first.run();

  const second = makeLoopProbe({script: [{text: "never"}]});
  await expect(second.run({
    resume: {
      messages: paused.messages,
      decisions: [{
        callId: "call-unknown",
        action: EResumeAction.APPROVE,
      }],
    },
  })).rejects.toMatchObject({
    status: 400,
    message: expect.stringContaining("names no pending tool call"),
  });
  expect([second.executed, second.modelCalls.length]).toEqual([[], 0]);
});
