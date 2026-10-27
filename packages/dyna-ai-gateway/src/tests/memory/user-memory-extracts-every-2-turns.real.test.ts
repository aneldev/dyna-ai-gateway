import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigMemory,
  memoryUserMemoryRepository,
} from "./memory.real.config";

const PLANTED_FACT = "XK-7731";

/**
 * With `extractEveryTurns: 2` the user's facts are extracted after the first answer of a thread (turn count 2). The prompt states a
 * fact about the user that no model knows (an invented invoice prefix); once the gateway is idle, a stored fact carries it.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — user memory, real provider", () => {
  test("a fact the user states in the first turn is stored after the answer", async () => {
    const gateway = new AIGateway(gatewayConfigMemory);

    const response = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: `Please remember this about me: my company's invoice prefix is ${PLANTED_FACT}. Just confirm.`,
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    const facts = await memoryUserMemoryRepository.load({
      tenantId: sampleUserContext.tenantId,
      userId: sampleUserContext.userId,
    });
    expect(facts.some(fact => fact.value.includes(PLANTED_FACT))).toBe(true);
  });
});
