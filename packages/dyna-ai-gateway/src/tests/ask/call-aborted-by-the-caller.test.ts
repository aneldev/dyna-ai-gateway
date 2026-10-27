import {dynaError} from "dyna-error";

import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  EIssueSeverity,
  TGatewayResponse,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  callAbort,
  gatewayConfigCallAbort,
} from "./call-abort.config";

/**
 * The caller aborts a running ask (the "stop" button): the call returns FAILED with the reason, nothing is thrown, the user turn
 * stays in the thread and no answer is stored. The thread's lease is released with the call, so the next ask on it goes through.
 */
test("an ask aborted while it runs is FAILED, keeps the user turn, stores no answer, and the thread takes the next ask", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigCallAbort, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const ask = (text: string, abortSignal?: AbortSignal, threadId?: string): ReturnType<AIGateway["ask"]> => {
    llmClient.enqueueComplete(makeModelResult({
      modelId: openAiModel.id,
      text,
    }));
    return gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      threadId,
      prompt: `Say ${text}`,
      kbFilters: noKb,
      abortSignal,
    });
  };
  const first = await ask("First.").response;
  if (first.kind !== EGatewayResponseKind.ANSWER) {
    throw dynaError({
      code: 5376325411001,
      message: `Test setup: expected ANSWER, got ${first.kind}`,
      data: {first},
    });
  }
  const controller = new AbortController();
  callAbort.controller = controller;

  let aborted: TGatewayResponse;
  try {
    aborted = await ask("Second.", controller.signal, first.threadId).response;
  }
  finally {
    callAbort.controller = undefined;
  }
  const later = await ask("Third.", undefined, first.threadId).response;

  const turns = await gatewayConfigCallAbort.threadStore.repository.loadTurns({
    tenantId: sampleUserContext.tenantId,
    threadId: first.threadId,
    desc: false,
    skip: 0,
    limit: 20,
  });
  expect([
    aborted,
    later.kind,
    turns.map(turn => turn.role),
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
    EGatewayResponseKind.ANSWER,
    [ETurnRole.USER, ETurnRole.ASSISTANT, ETurnRole.USER, ETurnRole.USER, ETurnRole.ASSISTANT],
  ]);
});
