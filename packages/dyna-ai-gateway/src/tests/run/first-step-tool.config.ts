import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

import {lookupOrderTool} from "./parallel-tools.config";

/** Offered on the first step only (`visibleWhen`, D89): the model classifies the request before it reaches for the other tools. */
export const classifyIntentTool = defineTool({
  name: "classify_intent",
  description: "Classifies the customer's request. Call it first.",
  inputSchema: z.object({intent: z.enum(["order", "refund", "other"])}),
  tags: ["routing"],
  visibleWhen: ({stepIndex}): boolean => stepIndex === 0,
  execute: async ({input: {intent}}): Promise<{intent: string}> => ({intent}),
});

/** A classifier for the first step and a read-only tool for the rest of the run. */
export const gatewayConfigFirstStepTool: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [classifyIntentTool.name, lookupOrderTool.name],
        },
      ],
    }),
  },
  toolRegistry: {
    tools: [
      classifyIntentTool,
      lookupOrderTool,
    ],
  },
};
