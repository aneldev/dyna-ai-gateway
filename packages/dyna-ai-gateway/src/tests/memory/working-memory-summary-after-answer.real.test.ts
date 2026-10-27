import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
} from "../..";

import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigMemory} from "./memory.real.config";

/**
 * After an answer the WorkingMemory updates the thread in the background: once the gateway is idle, the thread has a non-empty
 * summary and `updatedAtTurn` is the thread's turn count (2: the question and the answer).
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — working memory, real provider", () => {
  test("after the first answer the thread has a summary written at turn 2", async () => {
    const gateway = new AIGateway(gatewayConfigMemory);

    const response = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "I want to return the book I bought last week because two pages are missing. What are my options?",
      kbFilters: noKb,
    }).response;
    await gateway.whenIdle();
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

    const thread = await gatewayConfigMemory.threadStore.repository.loadThread({
      tenantId: sampleUserContext.tenantId,
      threadId: response.threadId,
    });
    expect([(thread?.workingMemory.summary ?? "").length > 0, thread?.workingMemory.updatedAtTurn]).toEqual([true, 2]);
  });
});
