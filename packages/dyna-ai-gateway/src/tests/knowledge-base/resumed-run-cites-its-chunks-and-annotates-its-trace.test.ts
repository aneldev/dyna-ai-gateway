import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigKbPausedRun,
  inTaxLibrary,
  refundDocument,
  toVector,
} from "./kb-paused-run.config";

/**
 * A resumed run is not poorer than a fresh one (D36): the chunks its first step searched are stored on the run, so the answer
 * of the resumed step cites them and every trace entry of the run, the resumed step's included, carries the chunk ids and the
 * version of the template the request was rendered from.
 */
test("the answer of a resumed run cites the chunks of its first step and its trace entries carry them with the template version", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigKbPausedRun, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.embedWith(toVector);
  await gateway.kbIngestor.ingestDocument({
    tenantId: sampleUser.tenantId,
    doc: refundDocument,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: refundTool.name,
      input: {amount: 500},
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Can I get a refund of invoice 4521?",
    kbFilters: inTaxLibrary,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5379462948337,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  llmClient.enqueueRunStep({text: "Refunded: a refund is possible within 12 months."});
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;
  const steps = await gateway.trace.query({
    tenantId: sampleUser.tenantId,
    filters: {
      threadId: paused.threadId,
      kind: ETraceKind.RUN_STEP,
    },
    skip: 0,
    limit: 10,
  });

  expect([
    response.kind === EGatewayResponseKind.ANSWER && response.citations,
    steps.map(entry => [entry.chunkIds, entry.templateVersion !== undefined]),
  ]).toEqual([
    ["refund-doc#0"],
    [[["refund-doc#0"], true], [["refund-doc#0"], true]],
  ]);
});
