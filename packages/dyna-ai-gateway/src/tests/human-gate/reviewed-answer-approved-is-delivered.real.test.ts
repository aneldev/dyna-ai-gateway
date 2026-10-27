import {
  AIGateway,
  EGatewayResponseKind,
  EModelProvider,
  EPartKind,
  EPauseKind,
  EResumeAction,
  ETurnRole,
} from "../..";

import {sampleUser} from "../internal/samples/profiles";
import {describeWithProvider} from "../internal/utils/describeWithProvider";
import {loadReviewDraft} from "../internal/utils/loadReviewDraft";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  REVIEW_TOKEN,
  gatewayConfigReviewAnswersReal,
} from "./review-answers.real.config";

/**
 * The whole review path on a real model (D99): the run pauses with the model's answer for review instead of delivering it,
 * APPROVE delivers exactly that text, and the thread holds it as the assistant turn. Structural assertions and the planted
 * token only, never the wording.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — reviewed answer on a real provider", () => {
  test("a real answer pauses for review and is delivered unchanged on APPROVE", async () => {
    const gateway = new AIGateway(gatewayConfigReviewAnswersReal);

    const paused = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: `My reference code is ${REVIEW_TOKEN}. Confirm you have it.`,
      kbFilters: noKb,
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected PAUSED, got ${paused.kind}: ${JSON.stringify(paused)}`);
    if (paused.envelopes[0].kind !== EPauseKind.RESULT_REVIEW) throw new Error(`Expected a RESULT_REVIEW pause, got ${paused.envelopes[0].kind}`);
    const draft = await loadReviewDraft({
      gateway,
      runId: paused.envelopes[0].runId,
    });

    const response = await gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
    }).response;

    const turns = await gatewayConfigReviewAnswersReal.threadStore.repository.loadTurns({
      tenantId: sampleUser.tenantId,
      threadId: paused.threadId,
      desc: false,
      skip: 0,
      limit: 10,
    });
    const lastTurn = turns[turns.length - 1];
    const lastText = lastTurn?.parts.find(part => part.kind === EPartKind.TEXT);
    expect([
      draft.includes(REVIEW_TOKEN),
      response.kind === EGatewayResponseKind.ANSWER ? response.text === draft : response.kind,
      lastTurn?.role,
      lastText?.kind === EPartKind.TEXT ? lastText.text === draft : null,
    ]).toEqual([
      true,
      true,
      ETurnRole.ASSISTANT,
      true,
    ]);
  });
});
