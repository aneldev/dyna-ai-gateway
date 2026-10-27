import {
  IModelInfo,
  EModelProvider,
} from "../../types";

/** An enabled OpenAI-like entry under our id; the tests of the admin methods flip or delete it. */
export const sampleModel = (modelId: string): IModelInfo => ({
  id: modelId,
  provider: EModelProvider.OPENAI,
  providerModelId: `${modelId}-2026`,
  label: modelId,
  caps: {
    tools: true,
    images: false,
    pdf: false,
    structuredOutput: true,
    reasoning: false,
    temperature: true,
    embeddings: false,
    contextTokens: 128_000,
    maxOutputTokens: 4_000,
    costInPerMTokUsd: 1,
    costOutPerMTokUsd: 2,
  },
  enabled: true,
  deprecatedAt: null,
});
