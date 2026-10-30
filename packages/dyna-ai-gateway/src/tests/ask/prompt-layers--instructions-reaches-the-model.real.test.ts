import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigPromptLayers} from "./prompt-layers.real.config";

/** The token the call's `instructions` make the model answer with. */
const PLANTED_INSTRUCTION_TOKEN = "PONG-7731";

/**
 * The `{instructions}` layer of the system prompt reaches the model: the call's `instructions` (D68) name a token no model
 * knows as the only answer, and a plain greeting gets it.
 *
 * Runs when AIGATEWAY_TEST_ANTHROPIC_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.ANTHROPIC)("AIGateway — prompt layers, instructions, real provider", () => {
  test("the call's instructions reach the model", async () => {
    const gateway = new AIGateway(gatewayConfigPromptLayers);

    const response = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Hello",
      instructions: `Answer only with ${PLANTED_INSTRUCTION_TOKEN}.`,
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    expect(response.text.includes(PLANTED_INSTRUCTION_TOKEN)).toBe(true);
  });
});
