import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  EIssueSeverity,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  callAbortAfterTheTurn,
  gatewayConfigCallAbortAfterTheTurn,
} from "./call-abort-after-the-turn.config";

/**
 * A call on a new thread is aborted right after its user turn was stored, before the search and the model: the FAILED response
 * names the thread the call created, so the host can find the turn, and the model is never called (nothing is enqueued).
 */
test("an ask on a new thread aborted after the user turn is FAILED and names the new thread", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigCallAbortAfterTheTurn, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const controller = new AbortController();
  callAbortAfterTheTurn.controller = controller;

  let response;
  try {
    response = await gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Hello",
      kbFilters: noKb,
      abortSignal: controller.signal,
    }).response;
  }
  finally {
    callAbortAfterTheTurn.controller = undefined;
  }

  const threadId = response.kind === EGatewayResponseKind.FAILED ? response.threadId : undefined;
  const turns = threadId === undefined
    ? []
    : await gatewayConfigCallAbortAfterTheTurn.threadStore.repository.loadTurns({
      tenantId: sampleUserContext.tenantId,
      threadId,
      desc: false,
      skip: 0,
      limit: 10,
    });
  expect([
    response,
    turns.map(turn => turn.role),
  ]).toEqual([
    {
      kind: EGatewayResponseKind.FAILED,
      threadId: expect.any(String),
      reason: "The call was aborted",
      issues: [
        {
          code: CALL_ABORTED_ISSUE_CODE,
          message: "The call was aborted",
          severity: EIssueSeverity.ERROR,
        },
      ],
    },
    [ETurnRole.USER],
  ]);
});
