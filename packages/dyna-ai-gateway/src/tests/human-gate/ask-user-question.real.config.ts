import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

export const gatewayConfigAskUserQuestion: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        promptAddendum: [
          "You prepare refunds for an accounting team. Two invoices are overdue: 4521 (Acme GmbH, 120 EUR) and 4522 (Globex Ltd, 80 EUR).",
          "When the request does not say which invoice, you MUST call the ask_user_question tool to ask; never guess and never ask in plain text.",
          `Once the invoice is known, answer with exactly: "Refund of invoice <number> is prepared."`,
        ].join(" "),
      }],
    }),
  },
  humanGate: {userQuestions: {enabled: true}},
};
