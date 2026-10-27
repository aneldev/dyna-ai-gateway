import {
  AIGateway,
  EGatewayResponseKind,
  EResumeAction,
  ERunStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigReviewAnswers,
  shipmentSchema,
} from "./review-answers.config";

/**
 * A stored run keeps no `outputSchema` (D36): the schema is the caller's code, handed to `resume` again. An EDIT of a structured
 * answer resumed without it cannot be parsed: delivering it would pair the reviewer's text with the model's unreviewed
 * `structured`. It is a 400, the run stays paused for a resume that brings the schema.
 */
test("an EDIT of a structured answer resumed without the output schema is a 400 and the run stays paused", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigReviewAnswers, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({text: "{\"status\": \"shipped\", \"eta\": \"Thursday\"}"});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Where is my order? Answer as data.",
    kbFilters: noKb,
    outputSchema: shipmentSchema,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected a pause, got ${paused.kind}`);
  const {
    runId,
    pauseId,
  } = paused.envelopes[0];
  const {repository} = gatewayConfigReviewAnswers.runStore;

  const refused: unknown = await gateway.resume({
    userContext: sampleUserContext,
    runId,
    pauseId,
    decisions: [{
      action: EResumeAction.EDIT,
      editedInput: "{\"status\": \"lost\", \"eta\": \"never\"}",
    }],
  }).response.then(() => null, (thrown: unknown) => thrown);

  const stillPaused = await repository.load({
    tenantId: sampleUser.tenantId,
    runId,
  });
  expect([refused, stillPaused?.status]).toMatchObject([
    {
      code: 5377210486183,
      status: 400,
    },
    ERunStatus.PAUSED,
  ]);
});
