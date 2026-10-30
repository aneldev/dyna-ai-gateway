import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigPromptLayers} from "./prompt-layers.real.config";

/** An invoice number no model knows; the call's `context` carries it. */
const PLANTED_INVOICE = "INV-55821";

/**
 * The `{context}` layer of the system prompt reaches the model: the call's `context` (D68) names an open invoice no model
 * knows, and the model, asked which invoice is open, answers with it.
 *
 * Runs when AIGATEWAY_TEST_ANTHROPIC_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.ANTHROPIC)("AIGateway — prompt layers, context, real provider", () => {
  test("the call's context reaches the model", async () => {
    const gateway = new AIGateway(gatewayConfigPromptLayers);

    const response = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Which invoice is open? Answer with the invoice number only.",
      context: `Open invoice: ${PLANTED_INVOICE}`,
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    expect(response.text.includes(PLANTED_INVOICE)).toBe(true);
  });
});
