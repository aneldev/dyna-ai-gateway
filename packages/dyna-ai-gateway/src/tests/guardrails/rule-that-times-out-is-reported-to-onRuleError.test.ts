import {
  AIGateway,
  EGatewayResponseKind,
  ERuleFailure,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigOnRuleErrorTimeout,
  ruleErrorReports,
} from "./on-rule-error.config";
import {
  RULE_TIMEOUT_MS,
  hangingRule,
} from "./rule-never-answers.config";

/**
 * A rule that gives no answer within its timeout is reported as TIMED_OUT: there is no error to hand over, and the report says
 * which timeout the rule ran under, so the developer can tell a hanging service from a timeout that is too short.
 */
test("a rule that times out is reported to onRuleError as TIMED_OUT with its timeout and no error", async () => {
  ruleErrorReports.length = 0;
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigOnRuleErrorTimeout, {llmClient: () => llmClient});
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
    report?.ruleName,
    report?.failure,
    report && "error" in report,
    report?.timeoutMs,
    (report?.durationMs ?? 0) >= RULE_TIMEOUT_MS,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    1,
    hangingRule.name,
    ERuleFailure.TIMED_OUT,
    false,
    RULE_TIMEOUT_MS,
    true,
  ]);
});
