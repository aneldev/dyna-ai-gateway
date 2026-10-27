import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigOrderSchema,
  orderSchema,
} from "./order-schema.config";
import {lookupOrderTool} from "./parallel-tools.config";

/**
 * A run with an `outputSchema`: the schema goes to the model on every step (the tool step and the answer step), and the final
 * text is parsed and checked against it, so the ANSWER carries the typed `structured` value next to the text.
 */
test("a run with an outputSchema sends it on every step and returns the parsed structured answer", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigOrderSchema, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: lookupOrderTool.name,
      input: {orderId: "A-1"},
    },
  });
  llmClient.enqueueRunStep({text: "{\"orderId\": \"A-1\", \"total\": 42}"});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Give me order A-1 as data",
    kbFilters: noKb,
    outputSchema: orderSchema,
  }).response;

  expect([
    response.kind,
    response.kind === EGatewayResponseKind.ANSWER && response.structured,
    llmClient.runCalls.map(call => call.request.outputSchema === orderSchema),
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    {
      orderId: "A-1",
      total: 42,
    },
    [true],
  ]);
});
