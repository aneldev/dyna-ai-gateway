import {
  AIGateway,
  BUILT_IN_TOOL_NAMES,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigHostToolWithAnOldBuiltInName,
  hostAskUserQuestionTool,
} from "./built-in-tool-names.config";

/**
 * The built-in tools carry the `dyna_aigw_` prefix, so an application tool named `ask_user_question` collides with nothing:
 * the gateway starts, and a run offers the model both, the application's tool and the built-in one.
 */
test("a host tool named ask_user_question is registered and offered next to the built-in user-question tool", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigHostToolWithAnOldBuiltInName, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({text: "Done."});

  await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Ask the customer how we did",
    kbFilters: noKb,
  }).response;

  expect(llmClient.runCalls[0]?.tools.map(tool => tool.name).sort()).toEqual([
    BUILT_IN_TOOL_NAMES.ASK_USER_QUESTION,
    hostAskUserQuestionTool.name,
  ].sort());
});
