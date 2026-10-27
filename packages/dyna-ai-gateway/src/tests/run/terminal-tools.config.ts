import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {getCurrentTimeTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Hands the conversation to a human agent; terminal by nature, so it ends the run (D86). */
export const handoverToAgentTool = defineTool({
  name: "handover_to_agent",
  description: "Hands the conversation over to a human support agent. Call it when the customer asks for a human.",
  inputSchema: z.object({reason: z.string()}),
  tags: ["support"],
  endsRun: true,
  execute: async ({input: {reason}}): Promise<{ticketId: string; reason: string}> => ({
    ticketId: "T-1",
    reason,
  }),
});

/** A read-only tool and a terminal one: the scenario of a tool that ends the run. */
export const gatewayConfigTerminalTools: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [getCurrentTimeTool.name, handoverToAgentTool.name],
        },
      ],
    }),
  },
  toolRegistry: {
    tools: [
      getCurrentTimeTool,
      handoverToAgentTool,
    ],
  },
};
