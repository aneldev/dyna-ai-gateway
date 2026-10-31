import {
  AIGateway,
  joinSystem,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  escalationSkill,
  exportWizardSkill,
  refundPolicySkill,
} from "../internal/samples/skills";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigAskSkills} from "./skills.config";

/** The call's skills are inlined after the profile's, in the order given (D124). */
test("an ask inlines the profile's skills and then the call's", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAskSkills, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Step 1 picks the columns.",
  }));

  await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What is the first step of the export?",
    kbFilters: noKb,
    skills: [exportWizardSkill],
  }).response;

  const system = joinSystem({blocks: llmClient.completeCalls[0].request.system});
  const positions = [refundPolicySkill, escalationSkill, exportWizardSkill].map(skill => system.indexOf(`## ${skill.name}\n\n${skill.body}`));
  expect(positions.every((position, index) => position > (positions[index - 1] ?? -1))).toBe(true);
});
