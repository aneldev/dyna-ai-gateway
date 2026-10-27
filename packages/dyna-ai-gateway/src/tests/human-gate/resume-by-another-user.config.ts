import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  InMemoryUserMemoryRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

import {refundOnApprovalTool} from "./paused-run-with-a-file.config";

/**
 * User memory on, extracted after every answer; one profile with a refund that pauses for approval, one that reviews its
 * answers: the asker's run is decided by another user of the tenant, an approver or a reviewer.
 */
export const gatewayConfigResumeByAnotherUser: IAIGatewayConfig = {
  ...gatewayConfigBase,
  userMemoryStore: {
    repository: new InMemoryUserMemoryRepository(),
    enabled: true,
    extractEveryTurns: 1,
  },
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [refundOnApprovalTool.name],
        },
        {
          ...sampleProfile,
          id: "reviewed",
          name: "Reviewed profile",
          reviewAnswers: true,
        },
      ],
    }),
  },
  toolRegistry: {tools: [refundOnApprovalTool]},
};
