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
 * A run started with an `outputSchema` keeps it through the review (D99): an edited text the schema rejects is a 400 with the
 * schema issue, refused before the run leaves PAUSED, so the reviewer can edit again; a text that matches is delivered with
 * its parsed `structured`.
 */
test("an edited structured answer that misses the schema is a 400 and the run stays paused; one that matches is delivered parsed", async () => {
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
  const resume = (editedInput: string): Promise<unknown> => gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{
      action: EResumeAction.EDIT,
      editedInput,
    }],
    // A stored run keeps no schema: the resume brings it again (D36)
    outputSchema: shipmentSchema,
  }).response;

  const refused: unknown = await resume("{\"status\": \"shipped\"}").then(() => null, (thrown: unknown) => thrown);
  const stillPaused = await gatewayConfigReviewAnswers.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });
  const delivered = await resume("{\"status\": \"shipped\", \"eta\": \"Friday\"}");

  expect([
    refused,
    stillPaused?.status,
    delivered,
  ]).toMatchObject([
    {
      status: 400,
      data: {issues: [{code: "output_schema"}]},
    },
    ERunStatus.PAUSED,
    {
      kind: EGatewayResponseKind.ANSWER,
      structured: {
        status: "shipped",
        eta: "Friday",
      },
    },
  ]);
});
