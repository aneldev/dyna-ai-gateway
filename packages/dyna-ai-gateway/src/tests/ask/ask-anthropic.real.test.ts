import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  ETraceKind,
} from "../..";

import {anthropicModel} from "../internal/samples/models";
import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  ANTHROPIC_CHAT_TOKEN,
  gatewayConfigAskAnthropic,
} from "./ask-anthropic.real.config";

/**
 * `ask()` on a real Anthropic model: the same plain chat as `ask-plain-chat.real.test.ts`, on the other provider.
 * The traced `chat` call proves the Anthropic model answered, not a default.
 *
 * Runs when AIGATEWAY_TEST_ANTHROPIC_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.ANTHROPIC)("AIGateway — ask, plain chat on Anthropic, real provider", () => {
  test("answers with the profile's token in one traced chat call on the Anthropic model", async () => {
    const gateway = new AIGateway(gatewayConfigAskAnthropic);

    const response = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Hello",
      kbFilters: noKb,
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    const chatCalls = await gateway.trace.query({
      tenantId: sampleUserContext.tenantId,
      filters: {kind: ETraceKind.CHAT},
      skip: 0,
      limit: 10,
    });
    expect([response.text.includes(ANTHROPIC_CHAT_TOKEN), chatCalls.map(entry => entry.modelId)]).toEqual([true, [anthropicModel.id]]);
  });
});
