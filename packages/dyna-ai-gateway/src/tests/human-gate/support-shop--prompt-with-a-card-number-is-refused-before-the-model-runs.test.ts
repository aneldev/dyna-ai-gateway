import {
  AIGateway,
  EGatewayResponseKind,
  EIssueSeverity,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigSupportShop,
  noPaymentDataRule,
} from "./support-shop.real.config";

/**
 * The guardrail of the scenario: a prompt that carries a card number is refused by the `no_payment_data` input rule before any
 * model call. The response is FAILED with the rule's issue, no thread was created (nothing to store), and the scripted model
 * (nothing enqueued) was never called — a call would have thrown. The card number is the test number of every payment provider.
 */
test("a prompt with a card number fails with the rule's issue, no thread is created and the model is never called", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSupportShop, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund order 1002 to my card 4111 1111 1111 1111 please.",
    kbFilters: noKb,
  }).response;

  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.ruleName, issue.code, issue.severity]),
    response.threadId,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[noPaymentDataRule.name, "payment_data_in_chat", EIssueSeverity.ERROR]],
    undefined,
  ]);
});
