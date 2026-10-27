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
  gatewayConfigSupportShop,
  ordersDb,
  refundOrderTool,
} from "./support-shop.real.config";

/**
 * The verification cannot be skipped: the scripted model calls `refund_order` with 19 EUR without having verified the customer
 * on this thread. The tool refuses (a 403), which the gateway stores and hands the model as a failed tool result whose error says
 * to verify first; the order is still delivered. The model then answers, and the run finishes. Nothing was refunded.
 */
test("a refund of 19 on an unverified thread is a failed tool result telling the model to verify first; the order is untouched", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSupportShop, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-refund",
      toolName: refundOrderTool.name,
      input: {
        orderId: "1002",
        amount: 19,
        reason: "arrived broken",
      },
    },
  });
  llmClient.enqueueRunStep({text: "I need to verify you first: what is the postcode of the delivery address?"});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund order 1002 in full, the phone case arrived broken.",
    kbFilters: noKb,
  }).response;
  if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}: ${JSON.stringify(response)}`);

  const toolResults = await loadToolResults({
    config: gatewayConfigSupportShop,
    threadId: response.threadId,
  });
  const refundResult = toolResults.find(part => part.toolName === refundOrderTool.name);
  const output = refundResult?.output;
  const error = typeof output === "object" && output !== null && "error" in output ? String(output.error) : "";
  expect([
    refundResult?.failed,
    error.includes("verify_customer"),
    ordersDb.find(order => order.orderId === "1002")?.status,
  ]).toEqual([
    true,
    true,
    "delivered",
  ]);
});
