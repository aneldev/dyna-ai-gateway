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
  scopeJudgeRule,
} from "./judge-scope.config";

/**
 * A prompt the judge rejects leaves its issues in the trace (D73): the GUARDRAIL_JUDGE entry of the judge call carries the
 * rule's issue, so an operator reading the trace sees why the call failed although no chat entry exists for it.
 */
test("the issues of a rejected prompt are annotated on the judge's trace entry", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigJudgeScope, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(judgeVerdict([{
    code: "out_of_scope",
    severity: EIssueSeverity.ERROR,
    message: "Not about invoices",
  }]), ETraceKind.GUARDRAIL_JUDGE);

  const response = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Tell me a joke",
    kbFilters: noKb,
  }).response;

  const judgeEntries = await gateway.trace.query({
    tenantId: sampleUserContext.tenantId,
    filters: {kind: ETraceKind.GUARDRAIL_JUDGE},
    skip: 0,
    limit: 10,
  });
  expect([
    response.kind,
    judgeEntries.map(entry => entry.issues.map(issue => [issue.ruleName, issue.code])),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[[scopeJudgeRule.name, "out_of_scope"]]],
  ]);
});
