import {
  IAIGatewayConfig,
  IAIProfile,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
} from "../..";

import {
  anthropicModel,
  openAiModel,
} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The profile a run starts on: OpenAI, refund allowed (pauses at 100 and above); the addendum leaves a real model the tool call only. */
export const openAiRefundProfile: IAIProfile = {
  ...sampleProfile,
  promptAddendum: [
    "You are a billing assistant. Be short.",
    "For every refund the user asks for you MUST call the refund tool with the amount as a number; never ask for confirmation in text.",
  ].join(" "),
  allowedTools: [refundTool.name],
};

/** The profile a paused run may resume on: Anthropic, the same tool. */
export const anthropicRefundProfile: IAIProfile = {
  ...openAiRefundProfile,
  id: "anthropic-refund",
  name: "Anthropic refund",
  modelId: anthropicModel.id,
};

/** The profile that does not allow refund: a resume on it is refused. */
export const noToolsProfile: IAIProfile = {
  ...sampleProfile,
  id: "no-tools",
  name: "No tools",
};

/** Two models, three profiles: a run paused on refund resumes on another profile (D65). */
export const gatewayConfigResumeOnAnotherProfile: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [openAiModel, anthropicModel]})},
  aiProfileStore: {repository: new InMemoryAIProfileRepository({profiles: [openAiRefundProfile, anthropicRefundProfile, noToolsProfile]})},
  toolRegistry: {tools: [refundTool]},
};
