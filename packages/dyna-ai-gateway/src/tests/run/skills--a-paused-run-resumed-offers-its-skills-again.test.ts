import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {
  exportWizardSkill,
  refundPolicySkill,
} from "../internal/samples/skills";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSkillsResume} from "./skills-resume.config";

/**
 * A run with a profile skill and a call skill pauses on the refund; the stored run keeps the call's skill (D124). After the
 * resume the model loads the profile's skill: `load_skill` was rebuilt, and the body lands in the thread as on the first step.
 */
test("a paused run resumed on its profile offers its skills again and stores the call's", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSkillsResume, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: "refund",
      input: {amount: 500},
    },
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-2",
      toolName: "load_skill",
      input: {name: refundPolicySkill.name},
    },
  });
  llmClient.enqueueRunStep({text: "Refunded; the policy was quoted."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 to the customer",
    kbFilters: noKb,
    skills: [exportWizardSkill],
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5380396461201,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const storedPaused = await gatewayConfigSkillsResume.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId: paused.envelopes[0].runId,
  });

  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigSkillsResume,
    threadId: paused.threadId ?? "",
  });
  expect([
    storedPaused?.skills,
    response.kind,
    toolResults.map(part => [part.callId, part.failed ?? false, part.output]),
  ]).toEqual([
    [exportWizardSkill],
    EGatewayResponseKind.ANSWER,
    [
      ["call-1", false, {refunded: 500}],
      [
        "call-2",
        false,
        {
          name: refundPolicySkill.name,
          body: refundPolicySkill.body,
        },
      ],
    ],
  ]);
});
