import {
  AIGateway,
  EGatewayResponseKind,
  EIssueSeverity,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigInputRuleBlocksPrompt,
  noFurnitureRule,
} from "./input-rule-blocks-prompt.config";

/**
 * An input rule that reports an ERROR fails the call before the model runs: the response is FAILED with the rule's issue,
 * and the scripted model (nothing enqueued) was never called — a call would have thrown.
 */
test("an off-topic prompt fails with the rule's issue and the model is never called", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigInputRuleBlocksPrompt, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  const response = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Do you sell cupboards?",
    kbFilters: noKb,
  }).response;

  expect([response.kind, response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.ruleName, issue.code, issue.severity])]).toEqual([
    EGatewayResponseKind.FAILED,
    [[noFurnitureRule.name, "topic_blocked", EIssueSeverity.ERROR]],
  ]);
});
