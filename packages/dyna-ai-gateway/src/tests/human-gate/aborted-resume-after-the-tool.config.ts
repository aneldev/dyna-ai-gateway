import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  EToolCallVerdict,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** A refund that needs approval and, once approved, answers at once. */
export const quickRefundTool = defineTool({
  name: "refund",
  description: "Refunds an amount to the customer.",
  inputSchema: z.object({amount: z.number()}),
  tags: ["billing"],
  policy: EToolCallVerdict.NEEDS_APPROVAL,
  execute: async ({input}): Promise<{refunded: number}> => ({refunded: input.amount}),
});

/** Registry: the quick refund; the profile allows it. */
export const gatewayConfigAbortedResumeAfterTheTool: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [quickRefundTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [quickRefundTool]},
};
