import {
  AIGateway,
  ILLMClientEvent,
  EGatewayResponseKind,
  ELLMClientEventKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {getCurrentTimeTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigBlockedRunAnswer,
  noLeakRule,
} from "./blocked-run-answer.config";

/**
 * A run whose answer an output rule blocks has already streamed that answer. The call ends its stream with ANSWER_WITHDRAWN
 * after DONE, carrying the rule's issue (D74), so a client can drop the text it rendered; the response is FAILED.
 */
test("a run answer that fails the output checks ends the stream with ANSWER_WITHDRAWN and the rule's issue", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigBlockedRunAnswer, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: getCurrentTimeTool.name,
      input: {},
    },
  });
  llmClient.enqueueRunStep({text: "The SECRET is 42."});

  const call = gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What time is it?",
    kbFilters: noKb,
  });
  const events: ILLMClientEvent[] = [];
  for await (const event of call.events) events.push(event);
  const response = await call.response;

  const last = events[events.length - 1];
  expect([
    response.kind,
    events.slice(-2).map(event => event.kind),
    last?.issues?.map(issue => [issue.ruleName, issue.code]),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [ELLMClientEventKind.DONE, ELLMClientEventKind.ANSWER_WITHDRAWN],
    [[noLeakRule.name, "leak"]],
  ]);
});
