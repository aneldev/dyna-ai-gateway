import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

import {
  CHARGE_AMOUNT,
  REFUND_APPROVAL_THRESHOLD,
  refundTool,
} from "./tool-policy.config";

/**
 * Billing on OpenAI: the `refund` tool's `policy` predicate decides with the three verdicts (D87) — at most
 * `REFUND_APPROVAL_THRESHOLD` runs directly, above it the run pauses for approval, above `CHARGE_AMOUNT` the call is denied and
 * the model reads why. The profile makes the tool call the only path; the model is not told the limits, the policy is.
 */
export const gatewayConfigRefundAbove100NeedsApproval: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        promptAddendum: [
          "You are a billing assistant. Be short.",
          "For every refund the user asks for you MUST call the refund tool with the amount as a number; never ask for confirmation in text.",
          "When the tool refuses, tell the user what the tool said and do not call it again.",
        ].join(" "),
        allowedTools: [refundTool.name],
      }],
    }),
  },
  toolRegistry: {tools: [refundTool]},
};

export {
  CHARGE_AMOUNT,
  REFUND_APPROVAL_THRESHOLD,
  refundTool,
};
