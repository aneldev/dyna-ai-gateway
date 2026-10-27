import {z} from "zod";

import {
  EPartKind,
  EToolCallVerdict,
  IToolDef,
  IToolResultPart,
  TToolCallPolicyResult,
} from "../../../contracts";

import {defineTool} from "../../tool-registry";

import {ERunOutcomeStatus} from "../types";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/**
 * A policy that reads state ("deny when the charge is already refunded") must see what the earlier calls of its own step
 * did. The model asks for the same refund twice in one parallel step: the first runs, the second is denied. Before, both
 * were decided up front, both were allowed, and the customer was refunded twice.
 */
test("two refunds of one charge in one parallel step: the first runs, the second is denied by the policy", async () => {
  const refunded = new Set<string>();
  const probe = makeLoopProbe({
    script: [
      {
        toolCalls: [
          {
            ...makeCall("refund", "call-1"),
            input: {chargeId: "ch1"},
          },
          {
            ...makeCall("refund", "call-2"),
            input: {chargeId: "ch1"},
          },
        ],
      },
      {text: "Refunded once."},
    ],
    offered: ["refund"],
  });
  const refundTool = defineTool({
    name: "refund",
    description: "",
    inputSchema: z.object({chargeId: z.string()}),
    tags: [],
    policy: ({input}): TToolCallPolicyResult => refunded.has(input.chargeId)
      ? {
        verdict: EToolCallVerdict.DENY,
        reason: "The charge is already refunded",
      }
      : {verdict: EToolCallVerdict.ALLOW},
    execute: async (): Promise<unknown> => undefined,
  });
  probe.hooks.prepareStep = (): IToolDef[] => [refundTool];
  // As ToolPolicy.decide runs the tool's predicate on the parsed input
  probe.hooks.decideToolCall = ({call}): TToolCallPolicyResult => refunded.has(z.object({chargeId: z.string()}).parse(call.input).chargeId)
    ? {
      verdict: EToolCallVerdict.DENY,
      reason: "The charge is already refunded",
    }
    : {verdict: EToolCallVerdict.ALLOW};
  probe.hooks.executeTool = async ({call}): Promise<unknown> => {
    // The refund takes a moment, as a payment API does: a decision taken meanwhile would not see it
    await new Promise(resolve => setTimeout(resolve, 5));
    refunded.add(z.object({chargeId: z.string()}).parse(call.input).chargeId);
    return {status: "refunded"};
  };

  const outcome = await probe.run();

  const results = outcome.messages.flatMap(message => message.parts)
    .filter((part): part is IToolResultPart => part.kind === EPartKind.TOOL_RESULT)
    .map(part => [part.callId, part.denied === true]);
  expect([outcome.status, results]).toEqual([
    ERunOutcomeStatus.DONE,
    [["call-1", false], ["call-2", true]],
  ]);
});
