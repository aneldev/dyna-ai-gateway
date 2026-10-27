import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  EToolCallVerdict,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** How many times the counted refund ran: the proof that one approval refunds once. */
export const refundExecutions = {count: 0};

/** A refund that pauses on every call and counts its executions. */
export const countedRefundTool = defineTool({
  name: "refund",
  description: "Refunds an amount to the customer.",
  inputSchema: z.object({amount: z.number()}),
  tags: ["billing"],
  policy: EToolCallVerdict.NEEDS_APPROVAL,
  execute: async ({input: {amount}}): Promise<{refunded: number}> => {
    refundExecutions.count += 1;
    return {refunded: amount};
  },
});

/** Registry: the counted refund; the profile allows it. */
export const gatewayConfigConcurrentResume: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [countedRefundTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [countedRefundTool]},
};
