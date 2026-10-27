import {EModelProvider} from "../../model-registry";

import {createEmbeddingModel} from "../utils/createEmbeddingModel";
import {makeModel} from "./utils/llmClientFixtures";

describe("createEmbeddingModel", () => {
  test("creates the OpenAI embedding model with the provider's model id", () => {
    const model = createEmbeddingModel({
      model: makeModel("embedding-a", EModelProvider.OPENAI, "text-embedding-3-small"),
      credentials: {apiKey: "test-key"},
    });
    expect(typeof model === "string" ? model : model.modelId).toBe("text-embedding-3-small");
  });

  test("a provider without embedding models in this client is a 400 (Anthropic)", () => {
    expect(() => createEmbeddingModel({
      model: makeModel("claude", EModelProvider.ANTHROPIC),
      credentials: {apiKey: "test-key"},
    })).toThrow(expect.objectContaining({
      code: 5372630367129,
      status: 400,
    }));
  });
});
