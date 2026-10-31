import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSkills} from "./skills.config";

/**
 * A name that is not among the call's skills fails the tool's input schema (an enum of the names): the model reads an invalid-input
 * error result (the registry's 400, `errorCode` on the stored part) and the run goes on to its answer; nothing is thrown.
 */
test("load_skill with a name outside the enum is an error result and the run goes on", async () => {
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
      input: {name: "shipping_policy"},
    },
  });
  llmClient.enqueueRunStep({text: "I have no shipping policy to follow."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What about shipping?",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigSkills,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    toolResults.map(part => [part.callId, part.failed, part.errorCode]),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [["call-1", true, 5372567786241]],
  ]);
});
