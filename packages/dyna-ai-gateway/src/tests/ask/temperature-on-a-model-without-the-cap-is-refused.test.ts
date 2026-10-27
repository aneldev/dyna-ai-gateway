import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigTemperatureRefused,
  temperatureRefusedThreadRepository,
} from "./temperature-refused.config";

/**
 * A temperature on a call whose profile's model does not accept one (`caps.temperature` false) is a dev error: the call is
 * refused with a 400 before anything happens, so no thread is created and the model is not called (D82).
 */
test("ask with a temperature on a model without caps.temperature is a 400 before anything is stored", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigTemperatureRefused, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  const call = gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
    temperature: 0.2,
  }).response;

  await expect(call).rejects.toMatchObject({
    code: 5376006538702,
    status: 400,
    data: {
      modelId: "gpt-5-mini",
      profileId: "default",
      temperature: 0.2,
    },
  });
  expect(llmClient.completeCalls).toHaveLength(0);
  const {items: threads} = await temperatureRefusedThreadRepository.listThreads({
    tenantId: sampleUserContext.tenantId,
    userId: sampleUserContext.userId,
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: null,
    },
  });
  expect(threads).toEqual([]);
});
