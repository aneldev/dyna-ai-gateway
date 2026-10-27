import {
  DEFAULT_TOOL_REJECTION_TEXT,
  EPartKind,
} from "../../../contracts";

import {EResumeAction} from "../../human-gate";
import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** A static `policy: NEEDS_APPROVAL` gives no text: the pause carries none and a REJECT writes the default lead; without a reason, the lead alone. */
test("without a policy text the pause carries none and a REJECT without a reason writes the default lead alone", async () => {
  const paused = await makeLoopProbe({
    script: [{toolCalls: [makeCall("refund")]}],
    offered: ["refund"],
    approvals: ["refund"],
  }).run();
  expect(paused.pendingCalls?.map(pending => "rejectionText" in pending)).toEqual([false]);

  const outcome = await makeLoopProbe({
    script: [{text: "Understood."}],
    offered: ["refund"],
  }).run({
    resume: {
      messages: paused.messages,
      decisions: [{action: EResumeAction.REJECT}],
    },
  });

  const result = outcome.messages.flatMap(message => message.parts.filter(part => part.kind === EPartKind.TOOL_RESULT))[0];
  expect([result?.rejected, result?.output]).toEqual([true, DEFAULT_TOOL_REJECTION_TEXT]);
});
