import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  ETraceKind,
  IAnswerResponse,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  PROMPT_CACHING_TOKEN,
  gatewayConfigPromptCaching,
} from "./prompt-caching-anthropic.real.config";

/**
 * The stable prefix of the system prompt is cached by Anthropic: three calls on one thread, the first one writes the
 * cache, the second and the third read it (`usage.cachedInputTokens > 0` on their traced chat calls), and every answer
 * still carries the addendum's token, so the cached block is the one the model reads.
 *
 * Three model calls: a cache read can only be observed on a call after the write. Runs when
 * AIGATEWAY_TEST_ANTHROPIC_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.ANTHROPIC)("AIGateway — prompt caching on Anthropic, real provider", () => {
  test("the second and third call of a thread read the system prefix from the cache", async () => {
    const gateway = new AIGateway(gatewayConfigPromptCaching);
    const prompts = ["Say hello.", "Say goodbye.", "Say thanks."];
    const answers: IAnswerResponse[] = [];
    let threadId: string | undefined;

    for (const prompt of prompts) {
      const response = await gateway.ask({
        profileId: "default",
        userContext: sampleUserContext,
        prompt,
        kbFilters: noKb,
        threadId,
      }).response;
      if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);
      answers.push(response);
      threadId = response.threadId;
    }
    await gateway.whenIdle();

    const chatCalls = (await gateway.trace.query({
      tenantId: sampleUserContext.tenantId,
      filters: {
        kind: ETraceKind.CHAT,
        threadId,
      },
      skip: 0,
      limit: 10,
    })).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    expect({
      calls: chatCalls.length,
      cacheReadOnCalls2And3: chatCalls.slice(1).map(entry => (entry.usage.cachedInputTokens ?? 0) > 0),
      tokenInEveryAnswer: answers.every(answer => answer.text.includes(PROMPT_CACHING_TOKEN)),
    }).toEqual({
      calls: 3,
      cacheReadOnCalls2And3: [true, true],
      tokenInEveryAnswer: true,
    });
  });
});
