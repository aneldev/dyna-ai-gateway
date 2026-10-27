import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";
import {TOOL_FAILURE_TEXT} from "../../internal";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  PLAIN_ERROR_MESSAGE,
  gatewayConfigPlainErrorTool,
  lookupStockTool,
} from "./plain-error-tool.config";

/**
 * A tool that lets a plain `Error` through leaks nothing: the registry wraps it in a 500 and the model reads the generic text
 * — the gateway's code, `status: 500`, `TOOL_FAILURE_TEXT` — never the message with the internal address. The failure is
 * logged on the server for the developer; the stored part carries the wrapper's code as `errorCode`; the run goes on.
 */
test("a tool that throws a plain error gives the model the generic text and keeps the message for the log", async () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigPlainErrorTool, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: lookupStockTool.name,
      input: {sku: "A-1"},
    },
  });
  llmClient.enqueueRunStep({text: "I cannot check the stock right now."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "How many A-1 are in stock?",
    kbFilters: noKb,
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigPlainErrorTool,
    threadId: response.threadId ?? "",
  });
  const logged = consoleError.mock.calls.map(call => String(call[0]));
  consoleError.mockRestore();
  expect([
    response.kind,
    toolResults.map(part => [part.toolName, part.output, part.failed, part.errorCode]),
    JSON.stringify(toolResults).includes(PLAIN_ERROR_MESSAGE),
    logged.length,
    logged[0]?.includes(PLAIN_ERROR_MESSAGE),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    [[lookupStockTool.name, {error: `code: 5376189327022, status: 500, userMessage: ${TOOL_FAILURE_TEXT}`}, true, 5376189327022]],
    false,
    1,
    true,
  ]);
});
