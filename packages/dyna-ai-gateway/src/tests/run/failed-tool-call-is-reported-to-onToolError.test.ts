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
  gatewayConfigOnToolError,
  toolErrorReports,
} from "./on-tool-error.config";
import {
  CHARGE_FAILURE_CODE,
  chargeCardTool,
} from "./throwing-tool.config";

/**
 * A tool that throws is reported to `onToolError` once, with the whole picture: who called, on which thread and step, the model's
 * call id (the same one the stored result carries), the parsed input, the error as the tool threw it, and the text the model read.
 * A fresh run has no `runId` yet. The model's answer is not affected.
 */
test("a failed tool call is reported to onToolError with the call id of the stored result", async () => {
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
    config: gatewayConfigOnToolError,
    threadId: response.threadId ?? "",
  });
  const [report] = toolErrorReports;
  const storedOutput = toolResults[0]?.output;
  const storedError = typeof storedOutput === "object" && storedOutput !== null && "error" in storedOutput ? storedOutput.error : undefined;
  expect([
    response.kind,
    toolErrorReports.length,
    report?.tenantId,
    report?.userContext,
    report?.threadId,
    report?.runId,
    report?.stepIndex,
    report?.callId,
    toolResults[0]?.callId,
    report?.toolName,
    report?.input,
    (report?.error as {code?: number} | undefined)?.code,
    report?.modelText,
    storedError,
    (report?.durationMs ?? -1) >= 0,
    report?.at instanceof Date,
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    1,
    sampleUserContext.tenantId,
    sampleUserContext,
    response.threadId,
    undefined,
    0,
    "call-1",
    "call-1",
    chargeCardTool.name,
    {amount: 30},
    CHARGE_FAILURE_CODE,
    storedError,
    storedError,
    true,
    true,
  ]);
});
