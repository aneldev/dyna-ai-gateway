import {
  EToolCallVerdict,
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
 * The human approved the edited input: a policy that answers NEEDS_APPROVAL for it does not pause the run a second time. A
 * tool in the profile's `approvals` always answers so; without this rule its edit could never run.
 */
test("an EDIT whose input the policy answers with NEEDS_APPROVAL is executed with the edited input", async () => {
  const probe = makeLoopProbe({
    script: [{text: "Refunded 20."}],
    offered: ["refund"],
  });
  const seenInputs: unknown[] = [];
  const executeTool = probe.hooks.executeTool;
  probe.hooks.executeTool = async (args): Promise<unknown> => {
    seenInputs.push(args.call.input);
    return executeTool(args);
  };
  probe.hooks.decideToolCall = (): TToolCallPolicyResult => ({verdict: EToolCallVerdict.NEEDS_APPROVAL});

  const outcome = await probe.run({
    resume: {
      messages: [{
        role: EMessageRole.ASSISTANT,
        parts: [{
          ...makeCall("refund"),
          input: {amount: 600},
        }],
      }],
      decisions: [{
        action: EResumeAction.EDIT,
        editedInput: {amount: 20},
      }],
    },
  });

  expect([outcome.status, probe.executed, seenInputs]).toEqual([ERunOutcomeStatus.DONE, ["refund"], [{amount: 20}]]);
});
