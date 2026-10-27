import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  ETraceKind,
} from "../..";

import {openAiModel} from "../internal/samples/models";
import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  PLAIN_CHAT_TOKEN,
  gatewayConfigAskPlainChat,
} from "./ask-plain-chat.real.config";

/**
 * `ask()` on a real OpenAI model: one grounded answer, no tools. The profile leaves the model one answer (a planted token),
 * so the assertion is structural: the response kind, the token, and that one `chat` call on the registered model was traced.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — ask, plain chat, real provider", () => {
  test("answers with the profile's token in one traced chat call", async () => {
    const gateway = new AIGateway(gatewayConfigAskPlainChat);

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
    expect([response.text.includes(PLAIN_CHAT_TOKEN), chatCalls.map(entry => entry.modelId)]).toEqual([true, [openAiModel.id]]);
  });
});
