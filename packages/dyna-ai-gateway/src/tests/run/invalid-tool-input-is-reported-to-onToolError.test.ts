import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigOnToolError,
  toolErrorReports,
} from "./on-tool-error.config";
import {chargeCardTool} from "./throwing-tool.config";

/**
 * The model's input missing the tool's schema is a failed call too, and the developer wants to know: it says the tool's description
 * or schema is unclear to the model. The report carries the gateway's 400 and the input as the model sent it (nothing was parsed);
 * the tool itself never ran, so it did not throw.
 */
test("a tool call with an invalid input is reported to onToolError with the raw input and the 400", async () => {
  toolErrorReports.length = 0;
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigOnToolError, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: chargeCardTool.name,
      input: {amount: "thirty"},
    },
  });
  llmClient.enqueueRunStep({text: "I could not charge the card."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Charge thirty to my card",
    kbFilters: noKb,
  }).response;

  const [report] = toolErrorReports;
  const error = report?.error as {code?: number; status?: number} | undefined;
  expect([
    response.kind,
    toolErrorReports.length,
    report?.callId,
    report?.toolName,
    report?.input,
    error?.code,
    error?.status,
    report?.modelText.startsWith("code: 5372567786241, status: 400, userMessage: Invalid input for tool [charge_card] at [amount]"),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    1,
    "call-1",
    chargeCardTool.name,
    {amount: "thirty"},
    5372567786241,
    400,
    true,
  ]);
});
