import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigPromptLayers} from "./prompt-layers.real.config";

/** A timezone no model assumes; the `{timezone}` slot renders it from `userContext.timezone`. */
const PLANTED_TIMEZONE = "Pacific/Chatham";

/**
 * The `{timezone}` layer of the system prompt reaches the model: the call's `userContext.timezone` is an unusual zone and
 * the model, asked for the user's timezone, answers with it.
 *
 * Runs when AIGATEWAY_TEST_ANTHROPIC_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.ANTHROPIC)("AIGateway — prompt layers, timezone, real provider", () => {
  test("the timezone of the user context reaches the model", async () => {
    const gateway = new AIGateway(gatewayConfigPromptLayers);

    const response = await gateway.ask({
      profileId: "default",
      userContext: {
        ...sampleUserContext,
        timezone: PLANTED_TIMEZONE,
      },
      prompt: "What is my timezone? Answer with the IANA timezone name only.",
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    expect(response.text.includes(PLANTED_TIMEZONE)).toBe(true);
  });
});
