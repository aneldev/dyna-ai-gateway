import {
  AIGateway,
  ERuleFailure,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  judgeVerdict,
  scopeJudgeRule,
} from "./judge-scope.config";
import {
  gatewayConfigOnRuleErrorJudge,
  ruleErrorReports,
} from "./on-rule-error.config";

/**
 * The judge's model answers in prose instead of the verdict shape: the rule fails, and its report carries the trace id of that
 * judge call, so the developer opens the trace entry and reads the request and the answer that broke the rule.
 */
test("a judge that answers out of shape is reported to onRuleError with the trace id of the judge call", async () => {
  ruleErrorReports.length = 0;
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigOnRuleErrorJudge, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(judgeVerdict([], {
    text: "Looks fine to me.",
    structured: undefined,
  }), ETraceKind.GUARDRAIL_JUDGE);
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

  await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What is on invoice 4521?",
    kbFilters: noKb,
  }).response;

  const judgeCalls = await gateway.trace.query({
    tenantId: sampleUserContext.tenantId,
    filters: {kind: ETraceKind.GUARDRAIL_JUDGE},
    skip: 0,
    limit: 10,
  });
  consoleError.mockRestore();
  const [report] = ruleErrorReports;
  expect([
    ruleErrorReports.length,
    report?.ruleName,
    report?.failure,
    report?.traceIds,
  ]).toEqual([
    1,
    scopeJudgeRule.name,
    ERuleFailure.THREW,
    judgeCalls.map(entry => entry.id),
  ]);
});
