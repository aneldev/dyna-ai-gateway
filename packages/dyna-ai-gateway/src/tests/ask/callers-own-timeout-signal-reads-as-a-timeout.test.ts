import {setTimeout as sleep} from "node:timers/promises";

import {
  AIGateway,
  CALL_TIMED_OUT_ISSUE_CODE,
  EGatewayResponseKind,
  EIssueSeverity,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigCallAbort} from "./call-abort.config";

/**
 * The caller passes its own `AbortSignal.timeout` as `abortSignal`, and it has fired: the call is refused as a timeout, with the
 * issue `call_timed_out` and words that name no number (the gateway set no deadline).
 */
test("an ask with the caller's own fired timeout signal is FAILED as timed out, without a number", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigCallAbort, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const abortSignal = AbortSignal.timeout(1);
  await sleep(20);

  const response = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
    abortSignal,
  }).response;

  expect(response).toEqual({
    kind: EGatewayResponseKind.FAILED,
    threadId: undefined,
    reason: "The call timed out",
    issues: [
      {
        code: CALL_TIMED_OUT_ISSUE_CODE,
        message: "The call timed out",
        severity: EIssueSeverity.ERROR,
      },
    ],
  });
});
