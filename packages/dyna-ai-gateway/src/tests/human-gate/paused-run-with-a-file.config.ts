import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  EToolCallVerdict,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** A refund that pauses on every call: the run pauses with the question's file in its messages. */
export const refundOnApprovalTool = defineTool({
  name: "refund",
  description: "Refunds an amount to the customer.",
  inputSchema: z.object({amount: z.number()}),
  tags: ["billing"],
  policy: EToolCallVerdict.NEEDS_APPROVAL,
  execute: async ({input: {amount}}): Promise<{refunded: number}> => ({refunded: amount}),
});

/** Registry: the refund; the profile allows it; the base model reads images. */
export const gatewayConfigPausedRunWithAFile: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [refundOnApprovalTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [refundOnApprovalTool]},
};
