import {
  AIGateway,
  EGatewayResponseKind,
  joinSystem,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  escalationSkill,
  refundPolicySkill,
} from "../internal/samples/skills";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigAskSkills} from "./skills.config";

/** An `ask()` has no tools, so the model cannot load anything: every skill body is in the system prompt, under its name, and no tool is offered (D124). */
test("an ask inlines the skill bodies in the system prompt and involves no tool", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAskSkills, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Within 14 days.",
  }));

  const response = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Can I get a refund?",
    kbFilters: noKb,
    debug: true,
  }).response;

  if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}`);
  const system = joinSystem({blocks: llmClient.completeCalls[0].request.system});
  expect([
    system.includes("Skills — instructions for this call:"),
    system.includes(`## ${refundPolicySkill.name}\n\n${refundPolicySkill.body}`),
    system.includes(`## ${escalationSkill.name}\n\n${escalationSkill.body}`),
    system.includes("load_skill"),
    llmClient.completeCalls[0].tools ?? [],
    response.debug?.steps,
  ]).toEqual([true, true, true, false, [], 1]);
});
