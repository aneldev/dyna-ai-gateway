import {
  AIGateway,
  EGatewayResponseKind,
  EIssueSeverity,
  ETraceKind,
  USAGE_DENIED_ISSUE_CODE,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  denial,
  gatewayConfigDenyChat,
  usageAdapterDenyingChat,
} from "./denied.config";

/**
 * The app says no to the answer's model call: the ask is FAILED with the one issue `usage_denied`, carrying the app's `denyCode`
 * in `data` and its `denyUserMessage` in `userMessage`; the model is not called (nothing is enqueued, so a call would throw) and
 * nothing is reported to the adapter.
 */
test("an answer call the app refuses fails the ask with usage_denied carrying the app's code and user message", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDenyChat, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  const response = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hi",
    kbFilters: noKb,
  }).response;

  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.reason,
    response.kind === EGatewayResponseKind.FAILED && response.issues,
    usageAdapterDenyingChat.checkCalls.map(call => call.kind),
    usageAdapterDenyingChat.addUsageCalls.length,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    "The usage adapter refused the model call",
    [{
      code: USAGE_DENIED_ISSUE_CODE,
      message: "The usage adapter refused the model call [fake-trace-1] (plan_exhausted)",
      severity: EIssueSeverity.ERROR,
      userMessage: denial.denyUserMessage,
      data: {denyCode: denial.denyCode},
    }],
    [ETraceKind.CHAT],
    0,
  ]);
});
