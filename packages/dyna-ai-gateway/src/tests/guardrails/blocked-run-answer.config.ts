import {
  IAIGatewayConfig,
  IIssue,
  IOutputRule,
  InMemoryAIProfileRepository,
  EIssueSeverity,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {getCurrentTimeTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

const LEAK = /\bSECRET\b/;

/** Output rule: an answer that leaks the word SECRET is blocked. No model is needed. */
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

/** A read-only tool the model may call, and one output rule that blocks the final answer. */
export const gatewayConfigBlockedRunAnswer: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [getCurrentTimeTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [getCurrentTimeTool]},
  guardrails: {outputRules: [noLeakRule]},
};
