import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {
  getCurrentTimeTool,
  refundTool,
} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Read-only: the model may call it without approval. A second read-only tool, so a step can ask for two. */
export const lookupOrderTool = defineTool({
  name: "lookup_order",
  description: "Returns the order of the given id.",
  inputSchema: z.object({orderId: z.string()}),
  tags: ["orders"],
  execute: async ({input: {orderId}}): Promise<{orderId: string; total: number}> => ({
    orderId,
    total: 42,
  }),
});

/** Two read-only tools and refund (pauses at 100 and above): the scenario of several tool calls in one model step. */
export const gatewayConfigParallelTools: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [getCurrentTimeTool.name, lookupOrderTool.name, refundTool.name],
        },
      ],
    }),
  },
  toolRegistry: {
    tools: [
      getCurrentTimeTool,
      lookupOrderTool,
      refundTool,
    ],
  },
};
