import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sendEmailTool} from "../internal/samples/tools";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigToolNotOffered} from "./tool-not-offered.config";

/**
 * A registry tool the profile does not allow is not offered to the model; when the model names it anyway (a tool seen earlier in
 * the thread, a hidden one guessed by name), the registry refuses it: it does not run, and the model gets a tool error instead of
 * a result. send_email needs approval, so a run that executed it would also have skipped the human gate.
 */
test("a tool the model was not offered is refused, not executed", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigToolNotOffered, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: sendEmailTool.name,
      input: {
        to: "a@b.c",
        subject: "Hi",
        body: "Hello",
      },
    },
  });
  llmClient.enqueueRunStep({text: "I cannot send emails here."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Email a@b.c and say hello",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigToolNotOffered,
    threadId: response.threadId ?? "",
  });
  const errorLogs = consoleError.mock.calls.length;
  consoleError.mockRestore();
  expect([
    response.kind,
    toolResults.map(part => [part.toolName, part.output]),
    errorLogs,
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [[sendEmailTool.name, {error: `code: 5375169186882, status: 403, userMessage: Tool [${sendEmailTool.name}] is not available in this run. Use one of the tools offered, or answer without it.`}]],
    1,
  ]);
});
