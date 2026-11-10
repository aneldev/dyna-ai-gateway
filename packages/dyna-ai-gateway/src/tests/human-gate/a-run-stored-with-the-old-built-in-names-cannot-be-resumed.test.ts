import {
  AIGateway,
  IRun,
  EResumeAction,
  ERunStatus,
  BUILT_IN_TOOL_NAMES,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {pauseOnUserQuestion} from "../internal/utils/pauseOnUserQuestion";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigUserQuestion,
  whichInvoiceAnswers,
  whichInvoiceQuestions,
} from "./user-question.config";

/**
 * A run paused by a version before the `dyna_aigw_` prefix stores the unprefixed names (`ask_user_question`). Nothing offers
 * them any more, so its resume is a clear 400 naming them, and the run stays PAUSED. The test writes such a run by renaming
 * the built-in in the `toolNames` of a freshly paused one, the field the resume finds its tools by.
 */
test("a run paused with the old ask_user_question name is a 400 on resume and stays paused", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigUserQuestion, {llmClient: () => llmClient});
  const paused = await pauseOnUserQuestion({
    gateway,
    llmClient,
    questions: whichInvoiceQuestions,
  });
  const runKey = {
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  };
  const repository = gatewayConfigUserQuestion.runStore.repository;
  const stored = await repository.load(runKey);
  if (!stored) throw new Error("Test setup: the paused run is not stored");
  const legacyRun: IRun = {
    ...stored,
    toolNames: stored.toolNames.map(name => name === BUILT_IN_TOOL_NAMES.ASK_USER_QUESTION ? "ask_user_question" : name),
  };
  await repository.save({run: legacyRun});

  const resumed = gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.ANSWER,
      answers: whichInvoiceAnswers,
    }],
  }).response;

  await expect(resumed).rejects.toMatchObject({
    code: 5387318840411,
    status: 400,
    data: {legacyTools: ["ask_user_question"]},
  });
  expect((await repository.load(runKey))?.status).toBe(ERunStatus.PAUSED);
});
