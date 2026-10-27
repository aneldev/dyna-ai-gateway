import {
  AIGateway,
  EGatewayResponseKind,
  EIssueSeverity,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigJudgeScope,
  judgeVerdict,
  modelAnswer,
  scopeJudgeRule,
} from "./judge-scope.config";

/**
 * The judge reports a WARNING only: the prompt passes, the main model answers, and the warning travels on the response
 * stamped with the rule's name. One judge call and one chat call were traced.
 */
test("a judge that reports a warning lets the prompt through; the warning is on the answer", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigJudgeScope, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(judgeVerdict([{
    code: "borderline",
    severity: EIssueSeverity.WARNING,
    message: "Mentions a supplier, not an invoice",
  }]), ETraceKind.GUARDRAIL_JUDGE);
  llmClient.enqueueComplete(modelAnswer("Acme is your supplier."));

  const response = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Who is Acme?",
    kbFilters: noKb,
  }).response;

  const traced = await gateway.trace.query({
    tenantId: sampleUserContext.tenantId,
    filters: {},
    skip: 0,
    limit: 10,
  });
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.ANSWER && response.issues.map(issue => [issue.ruleName, issue.code, issue.severity]),
    traced.map(entry => entry.kind).sort(),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [[scopeJudgeRule.name, "borderline", EIssueSeverity.WARNING]],
    [ETraceKind.CHAT, ETraceKind.GUARDRAIL_JUDGE].sort(),
  ]);
});
