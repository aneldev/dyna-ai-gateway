import {
  AIGateway,
  EGatewayResponseKind,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigJudgeScope,
  judgeVerdict,
  scopeJudgeRule,
} from "./judge-scope.config";

/**
 * The judge's model answers in prose instead of the verdict shape (no structured output, no JSON): the rule fails closed,
 * never passes. The response is FAILED with `rule_error`; the judge call was still reported to the usage adapter and traced (one GUARDRAIL_JUDGE entry).
 */
test("a judge that answers out of the verdict shape refuses the prompt with rule_error; the judge call is traced", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigJudgeScope, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(judgeVerdict([], {
    text: "Looks fine to me.",
    structured: undefined,
  }), ETraceKind.GUARDRAIL_JUDGE);
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

  const response = await gateway.ask({
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
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.ruleName, issue.code]),
    judgeCalls.length,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[scopeJudgeRule.name, "rule_error"]],
    1,
  ]);
});
