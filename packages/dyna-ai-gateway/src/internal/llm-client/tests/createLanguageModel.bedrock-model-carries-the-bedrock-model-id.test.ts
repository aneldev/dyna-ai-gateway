import {EModelProvider} from "../../model-registry";

import {createLanguageModel} from "../utils/createLanguageModel";
import {makeModel} from "./utils/llmClientFixtures";

/** A registry entry on `EModelProvider.BEDROCK` becomes a Bedrock SDK model that calls Bedrock's own model id, not ours. */
test("createLanguageModel — a Bedrock entry creates the Bedrock model with the provider's model id", () => {
  const model = createLanguageModel({
    model: makeModel("claude-haiku-4-5-bedrock", EModelProvider.BEDROCK, "anthropic.claude-haiku-4-5-20251001-v1:0"),
    credentials: {
      apiKey: "test-key",
      region: "eu-central-1",
    },
  });
  expect(typeof model === "string" ? model : [model.provider, model.modelId]).toEqual(["amazon-bedrock", "anthropic.claude-haiku-4-5-20251001-v1:0"]);
});
