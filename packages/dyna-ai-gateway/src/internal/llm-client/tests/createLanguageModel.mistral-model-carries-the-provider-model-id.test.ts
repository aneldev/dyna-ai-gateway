import {EModelProvider} from "../../model-registry";

import {createLanguageModel} from "../utils/createLanguageModel";
import {makeModel} from "./utils/llmClientFixtures";

/** A registry entry on `EModelProvider.MISTRAL` becomes the provider's SDK model, calling the provider's own model id. */
test("createLanguageModel — a MISTRAL entry creates the Mistral model with the provider's model id", () => {
  const model = createLanguageModel({
    model: makeModel("mistral-small", EModelProvider.MISTRAL, "mistral-small-latest"),
    credentials: {apiKey: "test-key"},
  });
  expect(typeof model === "string" ? model : [model.provider, model.modelId]).toEqual(["mistral.chat", "mistral-small-latest"]);
});
