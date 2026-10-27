import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  HANDLER_FAILURE_MESSAGE,
  gatewayConfigOnToolErrorThatThrows,
} from "./on-tool-error-that-throws.config";
import {chargeCardTool} from "./throwing-tool.config";

/**
 * The developer's handler is fire-and-forget: one that throws is logged on the server and ignored. The run goes on exactly as
 * without a handler — the model reads the tool's failure, answers, and the failed result is stored.
 */
test("an onToolError handler that throws is logged and the run is not affected", async () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigOnToolErrorThatThrows, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: chargeCardTool.name,
      input: {amount: 30},
    },
  });
  llmClient.enqueueRunStep({text: "The card was declined."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Charge 30 to my card",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigOnToolErrorThatThrows,
    threadId: response.threadId ?? "",
  });
  const handlerLogs = consoleError.mock.calls.filter(call => String(call[0]).includes("onToolError handler failed"));
  consoleError.mockRestore();
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.ANSWER && response.text,
    toolResults.map(part => [part.toolName, part.failed]),
    handlerLogs.length,
    (handlerLogs[0]?.[1] as Error | undefined)?.message,
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    "The card was declined.",
    [[chargeCardTool.name, true]],
    1,
    HANDLER_FAILURE_MESSAGE,
  ]);
});
