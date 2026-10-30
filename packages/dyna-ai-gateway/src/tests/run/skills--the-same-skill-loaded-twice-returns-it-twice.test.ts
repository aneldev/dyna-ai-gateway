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

/** Loading is idempotent: a model that asks for the same skill twice gets the same body twice, nothing is refused or cached away. */
test("the same skill loaded twice returns its body twice", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSkills, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  ["call-1", "call-2"].forEach(callId => llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId,
      toolName: "load_skill",
      input: {name: refundPolicySkill.name},
    },
  }));
  llmClient.enqueueRunStep({text: "Done."});

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
    toolResults.map(part => [part.callId, (part.output as {body?: string}).body]),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [
      ["call-1", refundPolicySkill.body],
      ["call-2", refundPolicySkill.body],
    ],
  ]);
});
