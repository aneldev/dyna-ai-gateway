import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {refundTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigGuardedToolsReported,
  guardedToolErrorReports,
} from "./guarded-tools-reported.config";

/**
 * A call the policy refuses for this step (`requires`, D88) never reaches the registry, and is still a failed call the developer
 * hears about: `createRunHooks` reports it through the same channel, with the policy's 403 and the step's index. One channel for
 * every failed call, wherever in the pipeline it failed.
 */
test("a tool call refused for the step by the policy is reported to onToolError like any other failed call", async () => {
  guardedToolErrorReports.length = 0;
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigGuardedToolsReported, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: refundTool.name,
      input: {amount: 5},
    },
  });
  llmClient.enqueueRunStep({text: "I need to look up the order first."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 5 on order A-1",
    kbFilters: noKb,
  }).response;

  const [report] = guardedToolErrorReports;
  const error = report?.error as {code?: number; status?: number} | undefined;
  expect([
    response.kind,
    guardedToolErrorReports.length,
    report?.callId,
    report?.stepIndex,
    report?.toolName,
    report?.input,
    error?.code,
    error?.status,
    report?.modelText.includes("Call lookup_order first"),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    1,
    "call-1",
    0,
    refundTool.name,
    {amount: 5},
    5376189327010,
    403,
    true,
  ]);
});
