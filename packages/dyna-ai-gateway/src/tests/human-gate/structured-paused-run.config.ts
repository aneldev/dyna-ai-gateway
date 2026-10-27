import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The shape the run must answer in; the test passes it as the call's `outputSchema` and again on the resume. */
export const refundReportSchema = z.object({
  invoiceId: z.string(),
  refunded: z.number(),
});

/** The refund tool, which pauses for approval from 100 on, and no review: the scenario of a structured run that pauses once. */
export const gatewayConfigStructuredPausedRun: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        allowedTools: [refundTool.name],
      }],
    }),
  },
  toolRegistry: {tools: [refundTool]},
};
