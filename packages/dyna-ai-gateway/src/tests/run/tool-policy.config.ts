import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  EToolCallVerdict,
  TToolCallPolicyResult,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {getCurrentTimeTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The charge a refund may not exceed: above it the policy denies the call. */
export const CHARGE_AMOUNT = 1_000;
/** Above this a refund waits for a human. */
export const REFUND_APPROVAL_THRESHOLD = 100;

/** Why a refund above the threshold waits for a human; the app's translation key. */
export const REFUND_REASON_CODE = "amountOverLimit";

/** Every refund the tool executed, in order: the proof of what the policy let through. */
export const refunds: number[] = [];

/**
 * A refund with the three verdicts (D87): below the threshold it runs, above it a human approves, above the charge it is refused.
 * A call that waits for approval tells the approval card why, as a code the app translates.
 */
export const refundTool = defineTool({
  name: "refund",
  description: "Refunds an amount in EUR to the customer.",
  inputSchema: z.object({amount: z.number()}),
  tags: ["billing"],
  policy: ({input}): TToolCallPolicyResult => {
    if (input.amount > CHARGE_AMOUNT) {
      return {
        verdict: EToolCallVerdict.DENY,
        reason: `The refund of ${input.amount} EUR is above the charge of ${CHARGE_AMOUNT} EUR; at most ${CHARGE_AMOUNT} EUR can be refunded.`,
      };
    }
    if (input.amount > REFUND_APPROVAL_THRESHOLD) {
      return {
        verdict: EToolCallVerdict.NEEDS_APPROVAL,
        rejectionText: `The refund of ${input.amount} EUR was declined by the support agent; nothing was refunded.`,
        reasonCode: REFUND_REASON_CODE,
      };
    }
    return {verdict: EToolCallVerdict.ALLOW};
  },
  execute: async ({input: {amount}}): Promise<{refunded: number}> => {
    refunds.push(amount);
    return {refunded: amount};
  },
});

/** A read-only tool and the refund with its policy: the scenario of a tool call decided by its policy. */
export const gatewayConfigToolPolicy: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [getCurrentTimeTool.name, refundTool.name],
        },
      ],
    }),
  },
  toolRegistry: {
    tools: [
      getCurrentTimeTool,
      refundTool,
    ],
  },
};
