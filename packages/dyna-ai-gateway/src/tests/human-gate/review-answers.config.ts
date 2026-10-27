import {z} from "zod";

import {
  IAIGatewayConfig,
  IAIProfile,
  IIssue,
  IOutputRule,
  InMemoryAIProfileRepository,
  EIssueSeverity,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {
  getCurrentTimeTool,
  refundTool,
} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

const LEAK = /\bSECRET\b/;

/** The shape a reviewed structured answer must keep, edited or not: the test passes it as the call's `outputSchema`. */
export const shipmentSchema = z.object({
  status: z.string(),
  eta: z.string(),
});

/** Output rule: an answer that leaks the word SECRET is blocked, so it never reaches a reviewer. No model is needed. */
export const noLeakRule: IOutputRule = {
  name: "no_leak",
  check: async ({evidence}): Promise<IIssue[]> =>
    typeof evidence.output === "string" && LEAK.test(evidence.output)
      ? [
        {
          code: "leak",
          message: "The answer leaks a secret",
          severity: EIssueSeverity.ERROR,
          field: "text",
        },
      ]
      : [],
};

/** A second profile without tools and without review: a reviewed run may be settled on it (D65), the review is already decided. */
export const plainProfile: IAIProfile = {
  ...sampleProfile,
  id: "plain",
  name: "Plain profile",
};

/**
 * A profile whose answers a human reviews before the user sees them (D99), with a read-only tool the model may call first,
 * a refund that pauses for approval from 100 on (a run can pause twice: the tool, then the answer), and one output rule that
 * blocks a leaking answer before any review.
 */
export const gatewayConfigReviewAnswers: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [getCurrentTimeTool.name, refundTool.name],
          reviewAnswers: true,
        },
        plainProfile,
      ],
    }),
  },
  toolRegistry: {tools: [getCurrentTimeTool, refundTool]},
  guardrails: {outputRules: [noLeakRule]},
};
