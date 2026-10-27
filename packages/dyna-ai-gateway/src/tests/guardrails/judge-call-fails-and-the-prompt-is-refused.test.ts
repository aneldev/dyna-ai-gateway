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
  scopeJudgeRule,
} from "./judge-scope.config";

/**
 * The judge's model call fails (provider down, unknown model, aborted): the rule fails closed. The response is FAILED with the
 * ERROR `rule_error` stamped with the rule's name, the failure is logged, and the main model never runs. The scripted model has
 * nothing enqueued for the judge, so its call throws, as a provider would.
 */
test("a judge whose model call fails refuses the prompt with rule_error; the main model never runs", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigJudgeScope, {llmClient: () => llmClient});
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

  const chats = await gateway.trace.query({
    tenantId: sampleUserContext.tenantId,
    filters: {kind: ETraceKind.CHAT},
    skip: 0,
    limit: 10,
  });
  const errorLogs = consoleError.mock.calls.length;
  consoleError.mockRestore();
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.ruleName, issue.code]),
    chats.length,
    errorLogs,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[scopeJudgeRule.name, "rule_error"]],
    0,
    1,
  ]);
});
