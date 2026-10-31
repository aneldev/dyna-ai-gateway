import {
  AIGateway,
  EGatewayResponseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {
  escalationSkill,
  exportWizardSkill,
  refundPolicySkill,
} from "../internal/samples/skills";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSkills} from "./skills.config";

/** A call's own skills join the profile's in the list, after them, in the order given (D124). */
test("a run lists the call's skills after the profile's", async () => {
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
    skills: [exportWizardSkill],
    debug: true,
  }).response;

  if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}`);
  const system = response.debug?.system ?? "";
  const positions = [refundPolicySkill, escalationSkill, exportWizardSkill].map(skill => system.indexOf(`- ${skill.name}: `));
  expect(positions.every((position, index) => position > (positions[index - 1] ?? -1))).toBe(true);
});
