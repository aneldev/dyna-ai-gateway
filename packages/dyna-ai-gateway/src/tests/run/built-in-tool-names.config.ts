import {z} from "zod";

import {
  IAIGatewayConfig,
  IAIProfile,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** An application tool named like the old, unprefixed built-in: the name is the application's now. */
export const hostAskUserQuestionTool = defineTool({
  name: "ask_user_question",
  description: "Asks the user through the application's own survey form.",
  inputSchema: z.object({question: z.string()}),
  tags: ["survey"],
  execute: async (): Promise<{sent: boolean}> => ({sent: true}),
});

/** An application tool that takes the prefix reserved for the built-in tools. */
export const prefixedHostTool = defineTool({
  name: "dyna_aigw_lookup_order",
  description: "Looks up an order by its id.",
  inputSchema: z.object({orderId: z.string()}),
  tags: ["orders"],
  execute: async (): Promise<{found: boolean}> => ({found: true}),
});

/** The sample profile, allowing the application's `ask_user_question`. */
const hostToolProfile: IAIProfile = {
  ...sampleProfile,
  allowedTools: [hostAskUserQuestionTool.name],
};

/** The built-in user-question tool switched on, next to the application's `ask_user_question`, which the profile allows. */
export const gatewayConfigHostToolWithAnOldBuiltInName: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {repository: new InMemoryAIProfileRepository({profiles: [hostToolProfile]})},
  toolRegistry: {tools: [hostAskUserQuestionTool]},
  humanGate: {userQuestions: {enabled: true}},
};

/** An application tool with the built-in prefix in the registry: the gateway refuses to start. */
export const gatewayConfigHostToolWithTheBuiltInPrefix: IAIGatewayConfig = {
  ...gatewayConfigBase,
  toolRegistry: {tools: [prefixedHostTool]},
};
