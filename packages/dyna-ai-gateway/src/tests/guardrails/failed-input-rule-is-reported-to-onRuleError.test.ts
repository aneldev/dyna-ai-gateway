import {
  AIGateway,
  EGatewayResponseKind,
  ERuleFailure,
  ERuleStage,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigOnRuleError,
  ruleErrorReports,
  ruleFailure,
  throwingInputRule,
} from "./on-rule-error.config";
import {RULE_TIMEOUT_MS} from "./rule-never-answers.config";

/**
 * An input rule that throws is reported to `onRuleError` once, with the whole picture: who called, the stage, how it failed,
 * the error as thrown (the caller never sees it), the very issue the response carries, and the evidence the rule checked.
 * A new thread does not exist yet, so the report has no `threadId`. The main model never runs (nothing enqueued).
 */
test("a failed input rule is reported to onRuleError with the error and the issue of the response", async () => {
  ruleErrorReports.length = 0;
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigOnRuleError, {llmClient: () => llmClient});
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

  consoleError.mockRestore();
  const [report] = ruleErrorReports;
  expect([
    response.kind,
    ruleErrorReports.length,
    report?.tenantId,
    report?.userContext,
    report?.threadId,
    report?.stage,
    report?.ruleName,
    report?.failure,
    report?.error,
    response.kind === EGatewayResponseKind.FAILED && response.issues,
    report?.evidence.prompt,
    report?.traceIds,
    report?.timeoutMs,
    (report?.durationMs ?? -1) >= 0,
    report?.at instanceof Date,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    1,
    sampleUserContext.tenantId,
    sampleUserContext,
    undefined,
    ERuleStage.INPUT,
    throwingInputRule.name,
    ERuleFailure.THREW,
    ruleFailure,
    [report?.issue],
    "What is on invoice 4521?",
    [],
    RULE_TIMEOUT_MS,
    true,
    true,
  ]);
});
