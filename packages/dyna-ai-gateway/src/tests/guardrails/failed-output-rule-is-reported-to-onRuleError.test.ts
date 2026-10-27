import {
  AIGateway,
  EGatewayResponseKind,
  ERuleFailure,
  ERuleStage,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {modelAnswer} from "./judge-scope.config";
import {
  gatewayConfigOnRuleErrorOnOutput,
  ruleErrorReports,
  ruleFailure,
  throwingOutputRule,
} from "./on-rule-error.config";

/**
 * An output rule that throws is reported on the OUTPUT stage, with the thread of the call and the answer it was checking as the
 * evidence's `output`; the caller gets FAILED with `rule_error`.
 */
test("a failed output rule is reported to onRuleError on the OUTPUT stage with the answer it checked", async () => {
  ruleErrorReports.length = 0;
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigOnRuleErrorOnOutput, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(modelAnswer("Invoice 4521 is 120 EUR."));
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
    report?.stage,
    report?.ruleName,
    report?.failure,
    report?.error,
    report?.threadId,
    report?.evidence && "output" in report.evidence && report.evidence.output,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    1,
    ERuleStage.OUTPUT,
    throwingOutputRule.name,
    ERuleFailure.THREW,
    ruleFailure,
    response.threadId,
    "Invoice 4521 is 120 EUR.",
  ]);
});
