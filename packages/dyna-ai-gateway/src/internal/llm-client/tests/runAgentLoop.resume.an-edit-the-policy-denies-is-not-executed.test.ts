import {
  EPartKind,
  EToolCallVerdict,
  IToolResultPart,
  TToolCallPolicyResult,
} from "../../../contracts";

import {EResumeAction} from "../../human-gate";

import {
  EMessageRole,
  ERunOutcomeStatus,
} from "../types";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/**
 * A human pushes an input past the policy by editing it: the refund of 600 waits for approval, the human edits it to 5 000,
 * which the policy denies. The edited input goes through the policy again: the call gets the denied result and does not run;
 * the other pending call, approved, runs; the run goes on.
 */
test("an EDIT whose input the policy denies gets the denied result and is not executed; the run goes on", async () => {
  const probe = makeLoopProbe({
    script: [{text: "The refund was refused."}],
    offered: ["refund", "log_event"],
  });
  probe.hooks.decideToolCall = ({call}): TToolCallPolicyResult => {
    if (call.toolName !== "refund") return {verdict: EToolCallVerdict.NEEDS_APPROVAL};
    return (call.input as {amount: number}).amount > 1_000
      ? {
        verdict: EToolCallVerdict.DENY,
        reason: "The amount is over the charge",
      }
      : {verdict: EToolCallVerdict.NEEDS_APPROVAL};
  };
  const refund = {
    ...makeCall("refund"),
    input: {amount: 600},
  };

  const outcome = await probe.run({
    resume: {
      messages: [{
        role: EMessageRole.ASSISTANT,
        parts: [refund, makeCall("log_event")],
      }],
      decisions: [
        {
          callId: refund.callId,
          action: EResumeAction.EDIT,
          editedInput: {amount: 5_000},
        },
        {
          callId: "call-log_event",
          action: EResumeAction.APPROVE,
        },
      ],
    },
  });

  const refundResult = outcome.messages.flatMap(message => message.parts)
    .find((part): part is IToolResultPart => part.kind === EPartKind.TOOL_RESULT && part.callId === refund.callId);
  expect([outcome.status, probe.executed, refundResult?.denied, String(refundResult?.output).endsWith("Reason: The amount is over the charge")]).toEqual([
    ERunOutcomeStatus.DONE,
    ["log_event"],
    true,
    true,
  ]);
});
