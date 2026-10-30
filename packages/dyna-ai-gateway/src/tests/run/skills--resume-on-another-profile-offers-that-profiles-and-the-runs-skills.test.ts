import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {
  escalationSkill,
  exportWizardSkill,
  refundPolicySkill,
} from "../internal/samples/skills";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  escalationProfile,
  gatewayConfigSkillsResume,
} from "./skills-resume.config";

/**
 * A run paused on the refund-policy profile resumes on the escalation profile (D65): `load_skill` is rebuilt from that
 * profile's skill and the run's own call skill (D124). The skill of the profile the run started on is no longer in the enum: the
 * model that still asks for it (the stored prompt lists it) gets the registry's invalid-input 400 as a tool result and goes on.
 */
test("a run resumed on another profile offers that profile's skills and the run's own; the old profile's is an error result", async () => {
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
    toolCalls: [
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-2",
        toolName: "load_skill",
        input: {name: escalationSkill.name},
      },
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-3",
        toolName: "load_skill",
        input: {name: exportWizardSkill.name},
      },
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-4",
        toolName: "load_skill",
        input: {name: refundPolicySkill.name},
      },
    ],
  });
  llmClient.enqueueRunStep({text: "Refunded and escalated."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 to the customer",
    kbFilters: noKb,
    skills: [exportWizardSkill],
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5380396461204,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.envelopes[0].pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
    profileId: escalationProfile.id,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigSkillsResume,
    threadId: paused.threadId ?? "",
  });
  expect([
    response.kind,
    toolResults.map(part => [part.callId, part.failed ?? false, part.failed ? part.errorCode : part.output]),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [
      ["call-1", false, {refunded: 500}],
      [
        "call-2",
        false,
        {
          name: escalationSkill.name,
          body: escalationSkill.body,
        },
      ],
      [
        "call-3",
        false,
        {
          name: exportWizardSkill.name,
          body: exportWizardSkill.body,
        },
      ],
      ["call-4", true, 5372567786241],
    ],
  ]);
});
