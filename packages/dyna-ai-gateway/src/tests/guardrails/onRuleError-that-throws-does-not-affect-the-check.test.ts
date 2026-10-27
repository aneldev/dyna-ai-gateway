import {
  AIGateway,
  EGatewayResponseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  HANDLER_FAILURE_MESSAGE,
  gatewayConfigOnRuleErrorThatThrows,
  throwingInputRule,
} from "./on-rule-error.config";

/**
 * The developer's handler is fire-and-forget: one that throws is logged on the server and ignored. The check ends exactly as
 * without a handler — FAILED with the rule's `rule_error`.
 */
test("an onRuleError handler that throws is logged and the check is not affected", async () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigOnRuleErrorThatThrows, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  const response = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What is on invoice 4521?",
    kbFilters: noKb,
  }).response;

  const handlerFailureLogged = consoleError.mock.calls.some(([, error]) => error instanceof Error && error.message === HANDLER_FAILURE_MESSAGE);
  consoleError.mockRestore();
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.ruleName, issue.code]),
    handlerFailureLogged,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[throwingInputRule.name, "rule_error"]],
    true,
  ]);
});
