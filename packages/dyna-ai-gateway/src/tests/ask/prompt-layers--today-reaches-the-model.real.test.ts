import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigPromptLayers} from "./prompt-layers.real.config";

/** A date no model takes for today; the `{today}` slot renders it from `userContext.now` in the user's timezone. */
const PLANTED_DATE = "2031-03-14";

/**
 * The `{today}` layer of the system prompt reaches the model: the call's `userContext.now` is a date in the future and the
 * model, asked for today's date, answers with it.
 *
 * Runs when AIGATEWAY_TEST_ANTHROPIC_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.ANTHROPIC)("AIGateway — prompt layers, today, real provider", () => {
  test("the today of the user context reaches the model", async () => {
    const gateway = new AIGateway(gatewayConfigPromptLayers);

    const response = await gateway.ask({
      profileId: "default",
      userContext: {
        ...sampleUserContext,
        now: new Date(`${PLANTED_DATE}T12:00:00Z`),
      },
      prompt: "What is today's date? Answer with the ISO date (YYYY-MM-DD) only.",
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    expect(response.text.includes(PLANTED_DATE)).toBe(true);
  });
});
