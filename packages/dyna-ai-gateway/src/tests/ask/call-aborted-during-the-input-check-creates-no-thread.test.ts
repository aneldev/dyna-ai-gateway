import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigCallAbortInTheInputCheck,
  inputCheckAbort,
} from "./call-abort-in-the-input-check.config";

/**
 * A call on a new thread is aborted while the input rules screen the prompt: nothing is created, the FAILED response names no
 * thread, and the model is never called (nothing is enqueued).
 */
test("an ask aborted during the input check is FAILED and creates no thread", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigCallAbortInTheInputCheck, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const controller = new AbortController();
  inputCheckAbort.controller = controller;

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
    inputCheckAbort.controller = undefined;
  }

  const {items: threads} = await gatewayConfigCallAbortInTheInputCheck.threadStore.repository.listThreads({
    tenantId: sampleUserContext.tenantId,
    userId: sampleUserContext.userId,
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: null,
    },
  });
  expect([
    response.kind,
    response.threadId,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => issue.code),
    threads.length,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    undefined,
    [CALL_ABORTED_ISSUE_CODE],
    0,
  ]);
});
