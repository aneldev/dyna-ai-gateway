import {EModelProvider} from "../../model-registry";

import {createEmbeddingModel} from "../utils/createEmbeddingModel";
import {makeModel} from "./utils/llmClientFixtures";

/** Mistral has embedding models: a MISTRAL entry is not a 400 like Anthropic's. */
test("createEmbeddingModel — a MISTRAL entry creates the Mistral embedding model with the provider's model id", () => {
  const model = createEmbeddingModel({
    model: makeModel("mistral-embed", EModelProvider.MISTRAL, "mistral-embed"),
    credentials: {apiKey: "test-key"},
  });
  expect(typeof model === "string" ? model : [model.provider, model.modelId]).toEqual(["mistral.embedding", "mistral-embed"]);
});
