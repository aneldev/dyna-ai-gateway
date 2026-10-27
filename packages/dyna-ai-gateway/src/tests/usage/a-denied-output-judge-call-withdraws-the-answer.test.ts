import {
  AIGateway,
  ILLMClientEvent,
  EGatewayResponseKind,
  ELLMClientEventKind,
  ETraceKind,
  USAGE_DENIED_ISSUE_CODE,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigDenyOutputJudge,
  usageAdapterDenyingOutputJudge,
} from "./denied.config";

/**
 * The answer was made and streamed, then the app says no to the output judge's model call: an answer nobody checked is not
 * shown. The ask is FAILED with `usage_denied`, the stream ends with ANSWER_WITHDRAWN, the answer's trace entry carries the
 * issue, and only the answer's call was reported to the adapter.
 */
test("an output judge call the app refuses withdraws the streamed answer and fails the ask with usage_denied", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDenyOutputJudge, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello there.",
  }));

  const call = gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hi",
    kbFilters: noKb,
  });
  const events: ILLMClientEvent[] = [];
  for await (const event of call.events) events.push(event);
  const response = await call.response;

  const chats = await gateway.trace.query({
    tenantId: sampleUserContext.tenantId,
    filters: {kind: ETraceKind.CHAT},
    skip: 0,
    limit: 10,
  });
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.ruleName, issue.code]),
    events.slice(-2).map(event => event.kind),
    chats.map(entry => entry.issues.map(issue => issue.code)),
    usageAdapterDenyingOutputJudge.checkCalls.map(call => call.kind),
    usageAdapterDenyingOutputJudge.addUsageCalls.map(call => call.kind),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[undefined, USAGE_DENIED_ISSUE_CODE]],
    [ELLMClientEventKind.DONE, ELLMClientEventKind.ANSWER_WITHDRAWN],
    [[USAGE_DENIED_ISSUE_CODE]],
    [ETraceKind.CHAT, ETraceKind.GUARDRAIL_JUDGE],
    [ETraceKind.CHAT],
  ]);
});
