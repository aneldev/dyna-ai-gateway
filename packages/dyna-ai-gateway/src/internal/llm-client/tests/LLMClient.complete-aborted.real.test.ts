import {EPartKind} from "../../../contracts";

import {describeWithProvider} from "../../../tests/internal/utils/describeWithProvider";
import {gatewayConfigBase} from "../../../tests/internal/utils/gatewayConfigBase";

import {EModelProvider} from "../../model-registry";

import {
  ELLMClientEventKind,
  EMessageRole,
} from "../types";
import {
  makeLLMClient,
  makeModel,
  makeRequest,
  meta,
} from "./utils/llmClientFixtures";

const openAiModel = process.env.AIGATEWAY_TEST_OPENAI_MODEL || "gpt-5-mini";

/**
 * A streaming call is aborted by the caller after its first text delta. The call rejects with the caller's reason within a
 * moment, not with the 502 of a provider failure; at most the deltas the SDK had already in hand follow the abort, not the
 * rest of the story.
 */
describeWithProvider(EModelProvider.OPENAI)("LLMClient.complete — real provider: aborted by the caller", () => {
  test("an abort after the first delta rejects with the caller's reason, not a 502", async () => {
    const client = await makeLLMClient([makeModel("openai-model", EModelProvider.OPENAI, openAiModel)], gatewayConfigBase.llmClient);
    const controller = new AbortController();
    const stopPressed = new Error("stop pressed");
    let deltasAfterAbort = 0;
    let abortedAt = 0;

    const call = client.complete({
      request: makeRequest({
        modelId: "openai-model",
        system: "You are a patient storyteller.",
        messages: [{
          role: EMessageRole.USER,
          parts: [{
            kind: EPartKind.TEXT,
            text: "Tell a long story of at least 600 words about a lighthouse keeper.",
          }],
        }],
        maxOutputTokens: 2_000,
      }),
      meta,
      abortSignal: controller.signal,
      hooks: {
        onEvent: ({event}): void => {
          if (event.kind !== ELLMClientEventKind.TEXT_DELTA) return;
          if (abortedAt) deltasAfterAbort++;
          else {
            abortedAt = Date.now();
            controller.abort(stopPressed);
          }
        },
      },
    });

    await expect(call).rejects.toBe(stopPressed);
    expect([Date.now() - abortedAt < 3_000, deltasAfterAbort <= 2]).toEqual([true, true]);
  }, 60_000);
});
