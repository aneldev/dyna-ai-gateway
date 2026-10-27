import {
  AIGateway,
  EGatewayResponseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  RULE_TIMEOUT_MS,
  gatewayConfigRuleNeverAnswers,
  hangingRule,
} from "./rule-never-answers.config";

/**
 * A rule that never answers (a hanging judge model, a hanging service) is ended by the gateway's rule timeout: the response is
 * FAILED with `rule_error` naming the timeout, the rule's signal is aborted, and the main model never runs (nothing enqueued).
 */
test("a rule that gives no answer within ruleTimeoutMs refuses the prompt with rule_error", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigRuleNeverAnswers, {llmClient: () => llmClient});
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
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.ruleName, issue.code, issue.message]),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[hangingRule.name, "rule_error", `The check [${hangingRule.name}] did not answer within ${RULE_TIMEOUT_MS} ms`]],
  ]);
});
