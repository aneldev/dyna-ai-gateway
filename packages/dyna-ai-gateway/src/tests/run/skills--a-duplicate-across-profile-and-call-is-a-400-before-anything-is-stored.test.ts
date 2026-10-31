import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {refundPolicySkill} from "../internal/samples/skills";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSkills} from "./skills.config";

/** A call skill named like a profile skill is a 400 (D124) decided before the input check: no judge call, no thread, no model call. */
test("a skill name present in the profile and the call is a 400 before anything is stored", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSkills, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  await expect(gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "hello",
    kbFilters: noKb,
    skills: [{
      ...refundPolicySkill,
      description: "Another text under the same name",
    }],
  }).response).rejects.toMatchObject({
    code: 5380126731579,
    status: 400,
    data: {duplicates: [refundPolicySkill.name]},
  });
  expect([
    llmClient.runCalls.length,
    await gatewayConfigSkills.threadStore.repository.listThreadIds({tenantId: sampleUserContext.tenantId}),
  ]).toEqual([0, []]);
});
