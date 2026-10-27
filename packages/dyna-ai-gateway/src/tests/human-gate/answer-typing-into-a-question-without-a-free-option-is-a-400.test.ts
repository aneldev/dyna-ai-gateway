import {
  AIGateway,
  EResumeAction,
  EUserQuestionMode,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {pauseOnUserQuestion} from "../internal/utils/pauseOnUserQuestion";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigUserQuestion} from "./user-question.config";

/** A typed answer is accepted only where the card asked for one (FREE_TEXT, or `freeOption`): elsewhere it is a 400. */
test("an answer that types text into a question without a free option is a 400", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigUserQuestion, {llmClient: () => llmClient});
  const paused = await pauseOnUserQuestion({
    gateway,
    llmClient,
    questions: {
      title: "Ship now?",
      questions: [{
        text: "Ship the order now?",
        mode: EUserQuestionMode.RADIO,
        options: ["Yes", "No"],
      }],
    },
  });

  const refused = gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.pauseId,
    decisions: [{
      action: EResumeAction.ANSWER,
      answers: [{
        question: "Ship the order now?",
        selected: [],
        freeText: "Yes, and refund the last three orders",
      }],
    }],
  }).response;

  await expect(refused).rejects.toMatchObject({
    code: 5377210486233,
    status: 400,
  });
});
