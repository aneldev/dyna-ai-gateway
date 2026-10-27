import {dynaError} from "dyna-error";

import {
  AIGateway,
  ILLMClientEvent,
  EGatewayResponseKind,
  ELLMClientEventKind,
  EPartKind,
  EPauseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {refundTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  cancelOrderTool,
  gatewayConfigParallelApprovals,
} from "./parallel-approvals.config";

/**
 * One step asks for two tools that both need approval. On a parallel profile (the default, D101) the run pauses once, with
 * one envelope per call in request order, each naming its `callId`, all sharing one `expiresAt` (D102); the stream carries
 * one RUN_PAUSED with both calls. Neither tool ran.
 */
test("two approvals in one step pause the run once, with two envelopes and one RUN_PAUSED", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigParallelApprovals, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCalls: [
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-1",
        toolName: refundTool.name,
        input: {amount: 500},
      },
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-2",
        toolName: cancelOrderTool.name,
        input: {orderId: "A-1"},
      },
    ],
  });
  const call = gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund 500 and cancel order A-1",
    kbFilters: noKb,
  });
  const events: ILLMClientEvent[] = [];
  for await (const event of call.events) events.push(event);
  const paused = await call.response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5376681234501,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }

  const pausedEvents = events.filter(event => event.kind === ELLMClientEventKind.RUN_PAUSED);
  expect([
    paused.envelopes.map(envelope => [envelope.kind, "callId" in envelope ? envelope.callId : null]),
    new Set(paused.envelopes.map(envelope => envelope.expiresAt.getTime())).size,
    pausedEvents.map(event => event.toolCalls?.map(toolCall => toolCall.callId)),
  ]).toEqual([
    [[EPauseKind.TOOL_APPROVAL, "call-1"], [EPauseKind.TOOL_APPROVAL, "call-2"]],
    1,
    [["call-1", "call-2"]],
  ]);
});
