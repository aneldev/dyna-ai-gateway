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

import {gatewayConfigIds} from "./ids.config";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * An id the gateway hands out is a capability: `resume` and `cancelRun` take a run by tenant and id (D32). The ids are
 * random v4 UUIDs from the platform's CSPRNG, so one id tells nothing about the next, nor when it was made.
 */
test("the thread and file ids the gateway hands out are random v4 UUIDs", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigIds, {llmClient: () => llmClient});
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello.",
  }));

  const answer = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
  }).response;
  const file = await gateway.uploadFile({
    userContext: sampleUserContext,
    bytes: new Uint8Array([137, 80, 78, 71]),
    mime: "image/png",
    name: "invoice.png",
  });

  expect([answer.kind, UUID_V4.test(answer.threadId ?? ""), UUID_V4.test(file.id)]).toEqual([EGatewayResponseKind.ANSWER, true, true]);
});
