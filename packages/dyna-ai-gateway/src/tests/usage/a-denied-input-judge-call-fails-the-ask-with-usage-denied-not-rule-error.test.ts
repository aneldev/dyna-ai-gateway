import {
  AIGateway,
  EGatewayResponseKind,
  ETraceKind,
  USAGE_DENIED_ISSUE_CODE,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigDenyInputJudge,
  usageAdapterDenyingInputJudge,
} from "./denied.config";

/**
 * The app says no to a judge's model call: the Guardrails pass the refusal through instead of failing the rule, so the ask is
 * FAILED with `usage_denied` (no rule name, no `rule_error`), nothing is logged as an internal error, and the answer's model call
 * is never asked for.
 */
test("an input judge call the app refuses fails the ask with usage_denied, not rule_error, and the main call is never asked", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDenyInputJudge, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

  const response = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What is on invoice 4521?",
    kbFilters: noKb,
  }).response;

  const errorLogs = consoleError.mock.calls.length;
  consoleError.mockRestore();
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.ruleName, issue.code]),
    usageAdapterDenyingInputJudge.checkCalls.map(call => call.kind),
    errorLogs,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[undefined, USAGE_DENIED_ISSUE_CODE]],
    [ETraceKind.GUARDRAIL_JUDGE],
    0,
  ]);
});
