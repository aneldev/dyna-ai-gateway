import {EPartKind} from "../../../contracts";

import {EResumeAction} from "../../human-gate";

import {ERunOutcomeStatus} from "../types";
import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/**
 * A parallel step left two calls pending. One resume carries a decision for each, by `callId` and in any order: the approved
 * call runs, the rejected one gets its rejected result, both land in request order, and the model is called once to answer.
 */
test("two decisions resolve two pending calls in one continuation, results in request order", async () => {
  const first = makeLoopProbe({
    script: [{toolCalls: [makeCall("log_event"), makeCall("get_invoice")]}],
    approvals: ["log_event", "get_invoice"],
  });
  const paused = await first.run();

  const second = makeLoopProbe({script: [{text: "done"}]});
  const outcome = await second.run({
    resume: {
      messages: paused.messages,
      decisions: [
        {
          callId: "call-get_invoice",
          action: EResumeAction.REJECT,
          text: "no",
        },
        {
          callId: "call-log_event",
          action: EResumeAction.APPROVE,
        },
      ],
    },
  });

  const results = outcome.messages.flatMap(message => message.parts.flatMap(part => part.kind === EPartKind.TOOL_RESULT ? [[part.callId, part.rejected ?? false]] : []));
  expect([
    paused.status,
    paused.pendingCalls?.length,
    outcome.status,
    outcome.result?.text,
    second.executed,
    second.modelCalls.length,
    results,
  ]).toEqual([
    ERunOutcomeStatus.PAUSED,
    2,
    ERunOutcomeStatus.DONE,
    "done",
    ["log_event"],
    1,
    [["call-log_event", false], ["call-get_invoice", true]],
  ]);
});
