import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  EIssueSeverity,
  ELLMClientEventKind,
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
 * The answer was streamed (TEXT_DELTA, DONE) when the caller presses "stop" during the output check: the stream ends with
 * ANSWER_WITHDRAWN carrying the abort's issue, as it does for a blocked answer (D74), so a client drops the text it rendered.
 */
test("an ask aborted during the output check withdraws the streamed answer with the abort's issue", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigCallAbort, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "An answer.",
  }));
  const controller = new AbortController();
  callAbort.controller = controller;

  const kinds: ELLMClientEventKind[] = [];
  let withdrawn;
  let response;
  try {
    const call = gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Say something",
      kbFilters: noKb,
      abortSignal: controller.signal,
    });
    for await (const event of call.events) {
      kinds.push(event.kind);
      if (event.kind === ELLMClientEventKind.ANSWER_WITHDRAWN) withdrawn = event.issues;
    }
    response = await call.response;
  }
  finally {
    callAbort.controller = undefined;
  }

  expect([response.kind, kinds, withdrawn]).toEqual([
    EGatewayResponseKind.FAILED,
    [ELLMClientEventKind.TEXT_DELTA, ELLMClientEventKind.DONE, ELLMClientEventKind.ANSWER_WITHDRAWN],
    [
      {
        code: CALL_ABORTED_ISSUE_CODE,
        message: "The call was aborted",
        severity: EIssueSeverity.ERROR,
      },
    ],
  ]);
});
