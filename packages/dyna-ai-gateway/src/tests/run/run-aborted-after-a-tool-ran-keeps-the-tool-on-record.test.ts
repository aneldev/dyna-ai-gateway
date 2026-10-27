import {
  AIGateway,
  CALL_ABORTED_ISSUE_CODE,
  EGatewayResponseKind,
  EPartKind,
  ERunStatus,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigAbortAfterATool,
  logEventTool,
} from "./abort-after-a-tool.config";

/**
 * The first step ran a tool; the caller presses "stop" the moment the second step's model call starts (it would take 10 s). The
 * call is FAILED, and the tool stays on record: the thread holds the user turn, the model's tool request and the tool's real
 * result, so the next call knows the event was logged; no run record exists.
 */
test("a run aborted after a tool ran is FAILED and keeps the tool call and its result in the thread", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAbortAfterATool, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: logEventTool.name,
      input: {name: "signup"},
    },
  });
  const controller = new AbortController();
  llmClient.enqueueRunStep({
    text: "Logged.",
    delayMs: 10_000,
    onCalled: (): void => controller.abort(),
  });

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Log the signup",
    kbFilters: noKb,
    abortSignal: controller.signal,
  }).response;

  const turns = await gatewayConfigAbortAfterATool.threadStore.repository.loadTurns({
    tenantId: sampleUserContext.tenantId,
    threadId: response.threadId ?? "",
    desc: false,
    skip: 0,
    limit: 10,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigAbortAfterATool,
    threadId: response.threadId ?? "",
  });
  const runs = (await Promise.all(Object.values(ERunStatus).map(status => gatewayConfigAbortAfterATool.runStore.repository.listByStatus({
    tenantId: sampleUserContext.tenantId,
    status,
  })))).flat();
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => issue.code),
    turns.map(turn => turn.role),
    toolResults.map(part => [part.callId, part.output, part.failed]),
    runs.length,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [CALL_ABORTED_ISSUE_CODE],
    [ETurnRole.USER, ETurnRole.ASSISTANT, ETurnRole.TOOL],
    [["call-1", {logged: true}, undefined]],
    0,
  ]);
});
