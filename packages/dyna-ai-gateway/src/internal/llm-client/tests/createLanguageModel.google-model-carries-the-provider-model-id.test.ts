import {EModelProvider} from "../../model-registry";

import {createLanguageModel} from "../utils/createLanguageModel";
import {makeModel} from "./utils/llmClientFixtures";

/** A registry entry on `EModelProvider.GOOGLE` becomes the provider's SDK model, calling the provider's own model id. */
test("createLanguageModel — a GOOGLE entry creates the Google model with the provider's model id", () => {
  const model = createLanguageModel({
    model: makeModel("gemini-2.5-flash", EModelProvider.GOOGLE, "gemini-2.5-flash"),
    credentials: {apiKey: "test-key"},
  });
  expect(typeof model === "string" ? model : [model.provider, model.modelId]).toEqual(["google.generative-ai", "gemini-2.5-flash"]);
});
