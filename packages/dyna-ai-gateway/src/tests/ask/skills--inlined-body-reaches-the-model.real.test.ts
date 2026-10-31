import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  RETURN_WINDOW_TOKEN,
  gatewayConfigSkillsReal,
} from "../run/skills.real.config";

/**
 * An `ask()` with a skill (D124): no tools, so the body is inlined in the system prompt and the model answers with the planted
 * return window in one step, no `load_skill` involved.
 *
 * Runs when AIGATEWAY_TEST_ANTHROPIC_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.ANTHROPIC)("AIGateway — ask with a skill, real provider", () => {
  test("the inlined skill body reaches the model in one step", async () => {
    const gateway = new AIGateway(gatewayConfigSkillsReal);

    const response = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "What is the return window?",
      kbFilters: noKb,
      debug: true,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    expect([
      response.text.includes(RETURN_WINDOW_TOKEN),
      response.debug?.steps,
    ]).toEqual([true, 1]);
  });
});
