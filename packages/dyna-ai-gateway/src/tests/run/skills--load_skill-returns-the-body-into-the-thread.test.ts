import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {refundPolicySkill} from "../internal/samples/skills";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSkills} from "./skills.config";

/** The model calls `load_skill` with a listed name: the tool result in the thread is `{name, body}` of that skill, and the run goes on to its answer. */
test("load_skill returns the skill's name and body as the tool result in the thread", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSkills, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: "load_skill",
      input: {name: refundPolicySkill.name},
    },
  });
  llmClient.enqueueRunStep({text: "Refunds are granted within 14 days."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Can I get a refund?",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigSkills,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    toolResults.map(part => [part.callId, part.failed ?? false, part.output]),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [
      [
        "call-1",
        false,
        {
          name: refundPolicySkill.name,
          body: refundPolicySkill.body,
        },
      ],
    ],
  ]);
});
