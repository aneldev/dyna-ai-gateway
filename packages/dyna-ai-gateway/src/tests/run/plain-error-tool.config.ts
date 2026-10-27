import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** What a tool's HTTP client throws when nobody caught it: an internal address the end user must never read. */
export const PLAIN_ERROR_MESSAGE = "connect ECONNREFUSED 10.0.4.12:5432";

/** A tool whose database client fails on every call and whose author caught nothing: a plain `Error` leaves `execute`. */
export const lookupStockTool = defineTool({
  name: "lookup_stock",
  description: "Returns the stock of an article.",
  inputSchema: z.object({sku: z.string()}),
  tags: ["warehouse"],
  execute: async (): Promise<{stock: number}> => {
    throw new Error(PLAIN_ERROR_MESSAGE);
  },
});

/** One tool that throws a plain `Error`; the profile allows it. */
export const gatewayConfigPlainErrorTool: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [lookupStockTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [lookupStockTool]},
};
