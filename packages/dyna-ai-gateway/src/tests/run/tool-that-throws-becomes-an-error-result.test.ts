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
  CHARGE_FAILURE_CODE,
  CHARGE_FAILURE_MESSAGE,
  CHARGE_FAILURE_USER_MESSAGE,
  chargeCardTool,
  gatewayConfigThrowingTool,
} from "./throwing-tool.config";

/**
 * A tool that throws does not end the run: its error becomes the tool's result (`{error}`), stored in the thread, so the model
 * reads it and can answer without the tool. The model reads the safe fields of the `dynaError` — code, status, userMessage —
 * in one line, never the `message` (the developer's); the stored part carries the code as `errorCode`. The run ends with the
 * model's answer, not with a thrown error.
 */
test("a tool that throws gives the model an error result and the run goes on", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigThrowingTool, {llmClient: () => llmClient});
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
    config: gatewayConfigThrowingTool,
    threadId: response.threadId ?? "",
  });
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.ANSWER && response.text,
    toolResults.map(part => [part.toolName, part.output, part.failed, part.errorCode]),
    JSON.stringify(toolResults).includes(CHARGE_FAILURE_MESSAGE),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    "The card was declined.",
    [[chargeCardTool.name, {error: `code: ${CHARGE_FAILURE_CODE}, status: 402, userMessage: ${CHARGE_FAILURE_USER_MESSAGE}`}, true, CHARGE_FAILURE_CODE]],
    false,
  ]);
});
