import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

export interface IPlaceOrderOutput {
  item: string;
  status: "placed" | "on_hold";
}

/**
 * Places the order; the shop puts a monitor on hold and places everything else. Ends the run only when the order was placed
 * (D86): the `endsRun` predicate reads the tool's own result.
 */
export const placeOrderTool = defineTool({
  name: "place_order",
  description: "Places the customer's order for one item. Returns the status: placed, or on_hold when the shop must check stock first.",
  inputSchema: z.object({item: z.string().describe("The item, in one or two words")}),
  tags: ["orders"],
  execute: async ({input: {item}}): Promise<IPlaceOrderOutput> => ({
    item,
    status: /monitor/i.test(item) ? "on_hold" : "placed",
  }),
  // After execute: the output type of the predicate is inferred from execute's return type
  endsRun: ({output}): boolean => output.status === "placed",
});

/** Ordering on OpenAI: the profile makes `place_order` the only path, once per request, and asks for a one-sentence report. */
export const gatewayConfigPlaceOrderEndsTheRunOnlyWhenPlaced: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        promptAddendum: [
          "You are the ordering assistant of a shop. Be short.",
          "For every item the customer asks to order you MUST call place_order exactly once; never ask for confirmation in text.",
          "Then report the status the tool returned in one sentence and call no other tool.",
        ].join(" "),
        allowedTools: [placeOrderTool.name],
      }],
    }),
  },
  toolRegistry: {tools: [placeOrderTool]},
};
