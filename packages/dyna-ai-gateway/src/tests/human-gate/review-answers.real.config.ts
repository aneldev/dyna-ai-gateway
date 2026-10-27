import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The token the model must repeat: no model knows it, so the delivered text is provably the model's reviewed answer. */
export const REVIEW_TOKEN = "RV-4471";

/**
 * A plain chat on OpenAI whose answers a human reviews before the user sees them (D99): no tools, the addendum makes the
 * model repeat the planted token so the test can recognise the answer it approved.
 */
export const gatewayConfigReviewAnswersReal: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        promptAddendum: "Be short. Every answer MUST contain the user's reference code exactly as written.",
        reviewAnswers: true,
      }],
    }),
  },
};
