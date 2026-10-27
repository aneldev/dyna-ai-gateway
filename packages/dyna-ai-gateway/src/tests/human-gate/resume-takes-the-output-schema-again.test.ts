import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {refundTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigStructuredPausedRun,
  refundReportSchema,
} from "./structured-paused-run.config";

/**
 * A stored run keeps no `outputSchema` (D36): a zod schema is code, not data. The caller hands it to `resume` again, and the
 * resumed step sends it to the model and parses the answer with it, so the ANSWER carries the typed `structured` value as a
 * run that never paused would.
 */
test("a structured run resumed with its schema again sends it to the model and returns the parsed answer", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigStructuredPausedRun, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
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
    prompt: "Refund invoice 4521 and report it as data",
    kbFilters: noKb,
    outputSchema: refundReportSchema,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5379462948359,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const stored = await gatewayConfigStructuredPausedRun.runStore.repository.load({
    tenantId: sampleUser.tenantId,
    runId: paused.envelopes[0].runId,
  });

  llmClient.enqueueRunStep({text: "{\"invoiceId\": \"4521\", \"refunded\": 500}"});
  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
    outputSchema: refundReportSchema,
  }).response;

  expect([
    stored !== null && "outputSchema" in stored.request,
    response.kind === EGatewayResponseKind.ANSWER && response.structured,
    llmClient.runCalls.map(call => call.request.outputSchema === refundReportSchema),
  ]).toEqual([
    false,
    {
      invoiceId: "4521",
      refunded: 500,
    },
    [true, true],
  ]);
});
