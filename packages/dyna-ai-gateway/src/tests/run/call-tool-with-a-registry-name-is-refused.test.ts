import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {refundTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigCallTools,
  lookupOrderTool,
} from "./call-tools.config";

/**
 * A call tool may not repeat a name of the registry or of another call tool (D66): the call is a 400 before anything is stored,
 * and the model (nothing enqueued) is never called.
 */
test("a call tool that repeats a registry name or another call tool's name is a 400", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigCallTools, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  const response = gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Refund order A-1",
    kbFilters: noKb,
    additionalTools: [refundTool, lookupOrderTool, lookupOrderTool],
  }).response;

  await expect(response).rejects.toMatchObject({
    status: 400,
    data: {duplicateTools: [refundTool.name, lookupOrderTool.name]},
  });
});
