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
 * A run whose final answer does not match the `outputSchema` fails the built-in output check: FAILED with `output_schema`
 * naming the field, the same rule as for ask(). The tool turn of the run stays stored (D70).
 */
test("a run answer that does not match the outputSchema is FAILED with output_schema", async () => {
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
  llmClient.enqueueRunStep({text: "{\"orderId\": \"A-1\", \"total\": \"forty-two\"}"});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Give me order A-1 as data",
    kbFilters: noKb,
    outputSchema: orderSchema,
  }).response;

  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.code, issue.field]),
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [["output_schema", "total"]],
  ]);
});
