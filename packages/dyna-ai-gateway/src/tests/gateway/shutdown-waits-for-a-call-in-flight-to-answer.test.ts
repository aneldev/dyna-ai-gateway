import {
  AIGateway,
  EGatewayResponseKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigShutdown} from "./shutdown.config";

/** A call that is running when `shutdown` begins ends within the grace period: it answers as usual, and the shutdown settles after it (D96). */
test("shutdown waits for a call in flight, which answers, and settles after it", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigShutdown, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(
    makeModelResult({
      modelId: openAiModel.id,
      text: "Done before the stop.",
    }),
    undefined,
    {delayMs: 300},
  );
  const order: string[] = [];

  const pending = gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hi",
    kbFilters: noKb,
  }).response.then(response => {
    order.push("answered");
    return response;
  });
  const stopped = gateway.shutdown({timeoutMs: 5_000}).then(() => order.push("shut down"));
  const [response] = await Promise.all([pending, stopped]);

  expect([
    response.kind,
    response.kind === EGatewayResponseKind.ANSWER && response.text,
    order,
  ]).toEqual([
    EGatewayResponseKind.ANSWER,
    "Done before the stop.",
    ["answered", "shut down"],
  ]);
});
