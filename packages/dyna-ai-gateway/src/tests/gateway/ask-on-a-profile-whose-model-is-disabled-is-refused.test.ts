import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigDisabledModel} from "./disabled-model.config";

/** An administrator switches a model off with `setEnabled`; the next `ask` on a profile of that model is refused before the model is called. */
test("ask on a profile whose model was disabled is refused with the registry's 400, and the model is not called", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDisabledModel, {llmClient: () => llmClient});
  await gateway.modelRegistry.setEnabled({
    modelId: openAiModel.id,
    enabled: false,
  });

  const refused = gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hi",
    kbFilters: noKb,
  }).response;

  await expect(refused).rejects.toMatchObject({
    code: 5372567786004,
    status: 400,
    data: {modelId: openAiModel.id},
  });
  expect(llmClient.completeCalls).toEqual([]);
});
