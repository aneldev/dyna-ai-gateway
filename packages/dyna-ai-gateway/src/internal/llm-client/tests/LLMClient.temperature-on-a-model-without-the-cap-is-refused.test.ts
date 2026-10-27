import {EModelProvider} from "../../model-registry";

import {createLanguageModel} from "../utils/createLanguageModel";
import {
  makeLLMClient,
  makeModel,
  makeRequest,
  meta,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createLanguageModel");

/** A request with a temperature on a model whose `caps.temperature` is false is a dev error: a 400 before the provider is built (D82). */
test("complete refuses a temperature on a model without caps.temperature, before the provider is called", async () => {
  const model = makeModel("model-a", EModelProvider.OPENAI);
  const client = await makeLLMClient(
    [{
      ...model,
      caps: {
        ...model.caps,
        temperature: false,
      },
    }],
    {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}},
  );

  const call = client.complete({
    request: {
      ...makeRequest(),
      temperature: 0,
    },
    meta,
  });

  await expect(call).rejects.toMatchObject({
    code: 5376006538701,
    status: 400,
    data: {
      modelId: "model-a",
      temperature: 0,
    },
  });
  expect(jest.mocked(createLanguageModel)).not.toHaveBeenCalled();
});
