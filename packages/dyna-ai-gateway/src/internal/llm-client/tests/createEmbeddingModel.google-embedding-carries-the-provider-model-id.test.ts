import {EModelProvider} from "../../model-registry";

import {createEmbeddingModel} from "../utils/createEmbeddingModel";
import {makeModel} from "./utils/llmClientFixtures";

/** Google has embedding models: a GOOGLE entry is not a 400 like Anthropic's. */
test("createEmbeddingModel — a GOOGLE entry creates the Google embedding model with the provider's model id", () => {
  const model = createEmbeddingModel({
    model: makeModel("gemini-embedding-001", EModelProvider.GOOGLE, "gemini-embedding-001"),
    credentials: {apiKey: "test-key"},
  });
  expect(typeof model === "string" ? model : [model.provider, model.modelId]).toEqual(["google.generative-ai", "gemini-embedding-001"]);
});
