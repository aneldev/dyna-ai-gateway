import {
  AIGateway,
  EGatewayResponseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {
  escalationSkill,
  refundPolicySkill,
} from "../internal/samples/skills";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSkills} from "./skills.config";

/**
 * A run on a profile with skills (D124): the system prompt lists every skill by name and description and tells the model to
 * call `load_skill`; the bodies stay out of the prompt, and `load_skill` is among the tools the model is offered.
 */
test("a run lists the profile's skills by name and description and offers load_skill", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSkills, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({text: "Hello."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "hello",
    kbFilters: noKb,
    debug: true,
  }).response;

  if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}`);
  const system = response.debug?.system ?? "";
  expect([
    system.includes("Call load_skill with the name to read one"),
    system.includes(`- ${refundPolicySkill.name}: ${refundPolicySkill.description}`),
    system.includes(`- ${escalationSkill.name}: ${escalationSkill.description}`),
    system.includes("REFUND-7731"),
    llmClient.runCalls[0]?.tools.map(tool => tool.name),
  ]).toEqual([true, true, true, false, ["load_skill"]]);
});
