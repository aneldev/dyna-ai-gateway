import {dynaError} from "dyna-error";

import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  EIssueSeverity,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigCallAbort} from "./call-abort.config";

/**
 * A signal that is already aborted when the call starts (the request closed before the handler ran) is answered FAILED at once:
 * no model call, no user turn, no lease kept; the thread is as it was.
 */
test("an ask with an already-aborted signal is FAILED before anything is stored", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigCallAbort, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "First.",
  }));
  const first = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Say First.",
    kbFilters: noKb,
  }).response;
  if (first.kind !== EGatewayResponseKind.ANSWER) {
    throw dynaError({
      code: 5376325411013,
      message: `Test setup: expected ANSWER, got ${first.kind}`,
      data: {first},
    });
  }

  const aborted = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    threadId: first.threadId,
    prompt: "Say Second.",
    kbFilters: noKb,
    abortSignal: AbortSignal.abort(),
  }).response;

  const turns = await gatewayConfigCallAbort.threadStore.repository.loadTurns({
    tenantId: sampleUserContext.tenantId,
    threadId: first.threadId,
    desc: false,
    skip: 0,
    limit: 20,
  });
  expect([
    aborted,
    turns.length,
  ]).toEqual([
    {
      kind: EGatewayResponseKind.FAILED,
      threadId: first.threadId,
      reason: "The call was aborted",
      issues: [
        {
          code: CALL_ABORTED_ISSUE_CODE,
          message: "The call was aborted",
          severity: EIssueSeverity.ERROR,
        },
      ],
    },
    2,
  ]);
});
