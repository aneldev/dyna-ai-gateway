import {EPartKind} from "../../../contracts";

import {EResumeAction} from "../../human-gate";
import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/**
 * The policy's `rejectionText` for the call (D87) leaves the loop with the pause and comes back with the decision: a REJECT stores
 * the composed text, lead plus the human's reason, as the call's result, so the stored part is what the model reads.
 */
test("a pause carries the policy's rejection text, and a REJECT writes it with the human's reason as the rejected result", async () => {
  const paused = await makeLoopProbe({
    script: [{toolCalls: [makeCall("refund")]}],
    offered: ["refund"],
    approvals: ["refund"],
    approvalTexts: {refund: "The refund of 500 was declined."},
  }).run();
  expect(paused.pendingCalls?.[0]?.rejectionText).toBe("The refund of 500 was declined.");

  const outcome = await makeLoopProbe({
    script: [{text: "Understood."}],
    offered: ["refund"],
  }).run({
    resume: {
      messages: paused.messages,
      decisions: [{
        action: EResumeAction.REJECT,
        text: "too much",
      }],
      rejectionTexts: Object.fromEntries((paused.pendingCalls ?? []).flatMap(pending => pending.rejectionText === undefined ? [] : [[pending.call.callId, pending.rejectionText]])),
    },
  });

  const results = outcome.messages.flatMap(message => message.parts.filter(part => part.kind === EPartKind.TOOL_RESULT));
  expect(results).toEqual([{
    kind: EPartKind.TOOL_RESULT,
    callId: "call-refund",
    toolName: "refund",
    output: "The refund of 500 was declined. Reason: too much",
    rejected: true,
  }]);
});
