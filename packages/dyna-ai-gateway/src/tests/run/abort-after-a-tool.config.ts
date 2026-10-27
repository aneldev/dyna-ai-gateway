import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** Read-only for the policy (no approval); answers at once. */
export const logEventTool = defineTool({
  name: "log_event",
  description: "Logs an event.",
  inputSchema: z.object({name: z.string()}),
  tags: ["test"],
  execute: async (): Promise<{logged: true}> => ({logged: true}),
});

/** One quick tool; the profile allows it. */
export const gatewayConfigAbortAfterATool: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [logEventTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [logEventTool]},
};
