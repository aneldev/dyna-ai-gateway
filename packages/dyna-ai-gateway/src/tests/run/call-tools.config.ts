import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
  EToolCallVerdict,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** A tool the app passes on the call, not in the registry (D66): no `policy`, runs at once. */
export const lookupOrderTool = defineTool({
  name: "lookup_order",
  description: "Returns the order of the given id.",
  inputSchema: z.object({orderId: z.string()}),
  tags: [],
  execute: async ({input: {orderId}}): Promise<{orderId: string; total: number}> => ({
    orderId,
    total: 42,
  }),
});

/** A call tool with `policy: NEEDS_APPROVAL`: pauses for approval like a registry tool. */
export const cancelOrderTool = defineTool({
  name: "cancel_order",
  description: "Cancels the order of the given id.",
  inputSchema: z.object({orderId: z.string()}),
  tags: [],
  policy: EToolCallVerdict.NEEDS_APPROVAL,
  execute: async ({input: {orderId}}): Promise<{cancelled: string}> => ({cancelled: orderId}),
});

/** Registry: refund only; the profile allows it. The call tools come with the call. */
export const gatewayConfigCallTools: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [refundTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [refundTool]},
};
