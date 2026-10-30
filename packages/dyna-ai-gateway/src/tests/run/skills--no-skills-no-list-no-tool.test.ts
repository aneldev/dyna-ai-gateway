import {
  AIGateway,
  EGatewayResponseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigNoSkills} from "./skills.config";

/** A profile and a call without skills: nothing about skills in the prompt and no `load_skill` among the tools (D124). */
test("a run without skills has no skills header and no load_skill tool", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigNoSkills, {llmClient: () => llmClient});
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
  expect([
    (response.debug?.system ?? "").includes("Skills"),
    llmClient.runCalls[0]?.tools.map(tool => tool.name),
  ]).toEqual([false, []]);
});
