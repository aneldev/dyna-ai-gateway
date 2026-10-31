import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  RETURN_WINDOW_TOKEN,
  gatewayConfigSkillsReal,
  returnsPolicySkill,
} from "./skills.real.config";

/**
 * A `run()` with a skill (D124): the system prompt lists it by name and description only, so the model must call `load_skill`
 * to learn the planted return window; the tool result is in the thread and the token is in the answer.
 *
 * Runs when AIGATEWAY_TEST_ANTHROPIC_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.ANTHROPIC)("AIGateway — run with a skill, real provider", () => {
  test("the model loads the skill with load_skill before it answers", async () => {
    const gateway = new AIGateway(gatewayConfigSkillsReal);

    const response = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "What is the return window?",
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    const toolResults = await loadToolResults({
      config: gatewayConfigSkillsReal,
      threadId: response.threadId,
    });
    expect([
      toolResults.map(part => [part.toolName, part.failed ?? false, part.output]),
      response.text.includes(RETURN_WINDOW_TOKEN),
    ]).toEqual([
      [[
        "load_skill",
        false,
        {
          name: returnsPolicySkill.name,
          body: returnsPolicySkill.body,
        },
      ]],
      true,
    ]);
  });
});
