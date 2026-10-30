import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigPromptLayers} from "./prompt-layers.real.config";

/** A code no model knows; a user fact set by hand carries it. */
const PLANTED_FACT_VALUE = "MEM-4417";

/**
 * The `{memory}` layer of the system prompt reaches the model: a user fact set with `upsertUserFact` before the call holds a
 * code no model knows, and the model, asked for it, answers with it.
 *
 * Runs when AIGATEWAY_TEST_ANTHROPIC_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.ANTHROPIC)("AIGateway — prompt layers, memory, real provider", () => {
  test("a remembered user fact reaches the model", async () => {
    const gateway = new AIGateway(gatewayConfigPromptLayers);
    await gateway.upsertUserFact({
      userContext: sampleUserContext,
      key: "favouriteCode",
      value: PLANTED_FACT_VALUE,
    });

    const response = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "What is my favourite code? Answer with the code only.",
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    expect(response.text.includes(PLANTED_FACT_VALUE)).toBe(true);
  });
});
