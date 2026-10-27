import {EResumeAction} from "../../human-gate";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** Two decisions for the same pending call are a 400, whichever comes first: the human's answer must be one per call. */
test("two decisions for one pending call are refused with a 400", async () => {
  const first = makeLoopProbe({
    script: [{toolCalls: [makeCall("log_event"), makeCall("get_invoice")]}],
    approvals: ["log_event", "get_invoice"],
  });
  const paused = await first.run();

  const second = makeLoopProbe({script: [{text: "never"}]});
  await expect(second.run({
    resume: {
      messages: paused.messages,
      decisions: [
        {
          callId: "call-log_event",
          action: EResumeAction.APPROVE,
        },
        {
          callId: "call-log_event",
          action: EResumeAction.REJECT,
        },
      ],
    },
  })).rejects.toMatchObject({
    status: 400,
    message: expect.stringContaining("two decisions"),
  });
  expect([second.executed, second.modelCalls.length]).toEqual([[], 0]);
});
