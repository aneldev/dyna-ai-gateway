import {
  AIGateway,
  EGatewayResponseKind,
  EPauseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigReviewAnswers} from "./review-answers.config";

/**
 * `listPausedRuns` is what the asker's UI lists: a summary per run, never the stored run (no system prompt with its memory
 * notes, no messages with the tool outputs) and a review without its draft. The reviewer reads the draft with `getPausedRun`.
 */
test("listPausedRuns gives the asker a summary without the draft or the prompt; getPausedRun gives the reviewer the draft", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigReviewAnswers, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({text: "Your order arrives Thursday."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "When does my order arrive?",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected a pause, got ${paused.kind}`);

  const [summary] = await gateway.listPausedRuns({userContext: sampleUserContext});
  const stored = await gateway.getPausedRun({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });

  const [card] = stored.pending ?? [];
  expect([
    summary && Object.keys(summary).sort(),
    summary?.envelopes.map(envelope => [envelope.kind, "result" in envelope]),
    JSON.stringify(summary).includes("Thursday"),
    card?.kind === EPauseKind.RESULT_REVIEW ? card.result?.text : null,
  ]).toEqual([
    ["createdAt", "envelopes", "expiresAt", "pauseId", "profileId", "runId", "threadId"],
    [[EPauseKind.RESULT_REVIEW, false]],
    false,
    "Your order arrives Thursday.",
  ]);
});
