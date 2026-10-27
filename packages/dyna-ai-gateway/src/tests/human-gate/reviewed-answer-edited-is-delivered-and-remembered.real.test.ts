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

/** The token of the reviewer's text: no model would write it, so a later answer that repeats it read the edited text. */
const EDITED_TOKEN = "ED-9920";

/**
 * EDIT on a real model's answer (D99): the run pauses with the model's draft, the reviewer replaces it, and the reviewer's
 * text is what is delivered and what the thread holds. A follow-up on the same thread asks which code the assistant said
 * is valid now and pauses with an answer that names the reviewer's token: only the edited turn holds it, so the model read
 * the edited text. (The profile makes every answer carry the user's own code too, so the draft's token is not asserted
 * absent.) Two model calls: the draft and the follow-up. Structural assertions and the planted tokens only, never the wording.
 *
 * Runs when AIGATEWAY_TEST_OPENAI_API_KEY is in .env (see .env.sample); skipped otherwise.
 */
describeWithProvider(EModelProvider.OPENAI)("AIGateway — edited reviewed answer on a real provider", () => {
  test("a real answer edited by the reviewer is delivered with the reviewer's text, and the thread remembers that text", async () => {
    const gateway = new AIGateway(gatewayConfigReviewAnswersReal);
    const editedText = `Noted. Your reference code is now ${EDITED_TOKEN}; the previous one is void.`;

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

    const edited = await gateway.resume({
      userContext: sampleUserContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{
        action: EResumeAction.EDIT,
        editedInput: editedText,
      }],
    }).response;

    const followUp = await gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      threadId: paused.threadId,
      prompt: "Which code did you tell me is valid now? Answer with that code only.",
      kbFilters: noKb,
    }).response;
    if (followUp.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected the follow-up to pause for review, got ${followUp.kind}: ${JSON.stringify(followUp)}`);
    if (followUp.envelopes[0].kind !== EPauseKind.RESULT_REVIEW) throw new Error(`Expected a RESULT_REVIEW pause, got ${followUp.envelopes[0].kind}`);
    const followUpDraft = await loadReviewDraft({
      gateway,
      runId: followUp.envelopes[0].runId,
    });

    const turns = await gatewayConfigReviewAnswersReal.threadStore.repository.loadTurns({
      tenantId: sampleUser.tenantId,
      threadId: paused.threadId,
      desc: false,
      skip: 0,
      limit: 10,
    });
    const assistantTexts = turns
      .filter(turn => turn.role === ETurnRole.ASSISTANT)
      .flatMap(turn => turn.parts.flatMap(part => part.kind === EPartKind.TEXT ? [part.text] : []));
    expect([
      draft.includes(REVIEW_TOKEN),
      edited.kind === EGatewayResponseKind.ANSWER ? edited.text : edited.kind,
      assistantTexts,
      followUpDraft.includes(EDITED_TOKEN),
    ]).toEqual([
      true,
      editedText,
      [editedText],
      true,
    ]);
  });
});
