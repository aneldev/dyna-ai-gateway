import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  PROMPT_LAYERS_ADDENDUM_TOKEN,
  gatewayConfigPromptLayers,
} from "./prompt-layers.real.config";

/**
 * The `{addendum}` layer of the system prompt reaches the model: the profile's addendum makes the model end every answer
 * with a token no model knows, and a plain greeting gets it.
 *
 * Runs when AIGATEWAY_TEST_ANTHROPIC_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.ANTHROPIC)("AIGateway — prompt layers, addendum, real provider", () => {
  test("the profile addendum reaches the model", async () => {
    const gateway = new AIGateway(gatewayConfigPromptLayers);

    const response = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Hello",
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    expect(response.text.includes(PROMPT_LAYERS_ADDENDUM_TOKEN)).toBe(true);
  });
});
