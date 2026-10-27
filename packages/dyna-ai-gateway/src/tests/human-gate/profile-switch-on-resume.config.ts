import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

import {refundOnApprovalTool} from "./paused-run-with-a-file.config";

/** Two profiles with the refund that pauses for approval: "reviewed" reviews its answers (D99), "unreviewed" does not. */
export const gatewayConfigProfileSwitchOnResume: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          id: "reviewed",
          name: "Reviewed profile",
          allowedTools: [refundOnApprovalTool.name],
          reviewAnswers: true,
        },
        {
          ...sampleProfile,
          id: "unreviewed",
          name: "Unreviewed profile",
          allowedTools: [refundOnApprovalTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [refundOnApprovalTool]},
};
