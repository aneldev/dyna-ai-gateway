import {
  AIGateway,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {pauseOnUserQuestion} from "../internal/utils/pauseOnUserQuestion";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigUserQuestion,
  whichInvoiceQuestions,
} from "./user-question.config";

/** A RADIO question takes one option: an answer that picks two is a 400. */
test("an answer that picks two options of a RADIO question is a 400", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigUserQuestion, {llmClient: () => llmClient});
  const paused = await pauseOnUserQuestion({
    gateway,
    llmClient,
    questions: whichInvoiceQuestions,
  });

  const refused = gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.pauseId,
    decisions: [{
      action: EResumeAction.ANSWER,
      answers: [{
        question: "Pick the invoice",
        selected: ["4521", "4522"],
      }],
    }],
  }).response;

  await expect(refused).rejects.toMatchObject({
    code: 5377210486229,
    status: 400,
  });
});
