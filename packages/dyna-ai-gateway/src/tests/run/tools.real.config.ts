import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {
  getCurrentTimeTool,
  sendEmailTool,
} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/**
 * Two tools on OpenAI: `get_current_time` runs directly; `send_email` has `policy: NEEDS_APPROVAL` and pauses for approval. The model may also ask the user (`ask_user_question`). The profile makes the tool calls the only path.
 */
export const gatewayConfigTools: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        promptAddendum: [
          "You are an office assistant. Be short.",
          "For any question about the time or the date you MUST call get_current_time; never answer from your own knowledge.",
          "To send an email you MUST call send_email with the recipient, subject and body the user gave; never ask for confirmation in text.",
        ].join(" "),
        allowedTools: [getCurrentTimeTool.name, sendEmailTool.name],
      }],
    }),
  },
  toolRegistry: {tools: [getCurrentTimeTool, sendEmailTool]},
  humanGate: {userQuestions: {enabled: true}},
};
