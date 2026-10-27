import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  ETraceKind,
} from "../..";

import {bedrockModel} from "../internal/samples/models";
import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  BEDROCK_CHAT_TOKEN,
  gatewayConfigAskBedrock,
} from "./ask-bedrock.real.config";

/**
 * `ask()` on a model served by Amazon Bedrock: the same plain chat as `ask-plain-chat.real.test.ts`, through AWS.
 * The traced `chat` call proves the Bedrock entry answered, not a default.
 *
 * Runs when AIGATEWAY_TEST_BEDROCK_API_KEY (and the region) is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.BEDROCK)("AIGateway — ask, plain chat on Amazon Bedrock, real provider", () => {
  test("answers with the profile's token in one traced chat call on the Bedrock model", async () => {
    const gateway = new AIGateway(gatewayConfigAskBedrock);

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
    expect([response.text.includes(BEDROCK_CHAT_TOKEN), chatCalls.map(entry => entry.modelId)]).toEqual([true, [bedrockModel.id]]);
  });
});
