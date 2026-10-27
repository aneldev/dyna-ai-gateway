import {EModelProvider} from "../../model-registry";

import {createEmbeddingModel} from "../utils/createEmbeddingModel";
import {makeModel} from "./utils/llmClientFixtures";

/** Bedrock serves embedding models too (Titan, Cohere): a Bedrock entry is not a 400 like Anthropic's. */
test("createEmbeddingModel — a Bedrock entry creates the Bedrock embedding model with the provider's model id", () => {
  const model = createEmbeddingModel({
    model: makeModel("titan-embed-v2", EModelProvider.BEDROCK, "amazon.titan-embed-text-v2:0"),
    credentials: {apiKey: "test-key"},
  });
  expect(typeof model === "string" ? model : [model.provider, model.modelId]).toEqual(["amazon-bedrock", "amazon.titan-embed-text-v2:0"]);
});
