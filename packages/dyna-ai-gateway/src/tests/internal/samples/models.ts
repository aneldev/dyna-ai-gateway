import {
  IModelInfo,
  EModelProvider,
} from "../../..";

/** The models a config registers; a provider's key must be in the repo-root `.env` (see `utils/loadProviderCredentials.ts`). */

export const openAiModel: IModelInfo = {
  id: "gpt-5-mini",
  provider: EModelProvider.OPENAI,
  providerModelId: "gpt-5-mini",
  label: "OpenAI GPT-5 mini",
  caps: {
    tools: true,
    images: true,
    pdf: true,
    structuredOutput: true,
    reasoning: true,
    temperature: false,
    embeddings: false,
    contextTokens: 400_000,
    maxOutputTokens: 16_000,
    costInPerMTokUsd: 0.25,
    costOutPerMTokUsd: 2,
  },
  enabled: true,
  deprecatedAt: null,
};

export const anthropicModel: IModelInfo = {
  id: "claude-haiku-4-5",
  provider: EModelProvider.ANTHROPIC,
  providerModelId: "claude-haiku-4-5-20251001",
  label: "Anthropic Claude Haiku 4.5",
  caps: {
    tools: true,
    images: true,
    pdf: true,
    structuredOutput: true,
    reasoning: true,
    temperature: true,
    embeddings: false,
    contextTokens: 200_000,
    maxOutputTokens: 8_000,
    costInPerMTokUsd: 1,
    costOutPerMTokUsd: 5,
  },
  enabled: true,
  deprecatedAt: null,
};

export const openAiEmbeddingModel: IModelInfo = {
  id: "text-embedding-3-small",
  provider: EModelProvider.OPENAI,
  providerModelId: "text-embedding-3-small",
  label: "OpenAI text-embedding-3-small",
  caps: {
    tools: false,
    images: false,
    pdf: false,
    structuredOutput: false,
    reasoning: false,
    temperature: false,
    embeddings: true,
    contextTokens: 8_191,
    maxOutputTokens: 0,
    costInPerMTokUsd: 0.02,
    costOutPerMTokUsd: 0,
  },
  enabled: true,
  deprecatedAt: null,
};

/** The Anthropic model of `anthropicModel`, served by Amazon Bedrock under Bedrock's model id; needs the Bedrock key and region in `.env`. */
export const bedrockModel: IModelInfo = {
  id: "claude-haiku-4-5-bedrock",
  provider: EModelProvider.BEDROCK,
  providerModelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
  label: "Anthropic Claude Haiku 4.5 on Amazon Bedrock",
  caps: {...anthropicModel.caps},
  enabled: true,
  deprecatedAt: null,
};

/** Google's cheap chat model; needs AIGATEWAY_TEST_GOOGLE_API_KEY in `.env`. */
export const googleModel: IModelInfo = {
  id: "gemini-2.5-flash",
  provider: EModelProvider.GOOGLE,
  providerModelId: "gemini-2.5-flash",
  label: "Google Gemini 2.5 Flash",
  caps: {
    tools: true,
    images: true,
    pdf: true,
    structuredOutput: true,
    reasoning: true,
    temperature: true,
    embeddings: false,
    contextTokens: 1_000_000,
    maxOutputTokens: 64_000,
    costInPerMTokUsd: 0.3,
    costOutPerMTokUsd: 2.5,
  },
  enabled: true,
  deprecatedAt: null,
};

/** Mistral's cheap chat model; needs AIGATEWAY_TEST_MISTRAL_API_KEY in `.env`. */
export const mistralModel: IModelInfo = {
  id: "mistral-small",
  provider: EModelProvider.MISTRAL,
  providerModelId: "mistral-small-latest",
  label: "Mistral Small",
  caps: {
    tools: true,
    images: true,
    pdf: false,
    structuredOutput: true,
    reasoning: false,
    temperature: true,
    embeddings: false,
    contextTokens: 128_000,
    maxOutputTokens: 8_000,
    costInPerMTokUsd: 0.1,
    costOutPerMTokUsd: 0.3,
  },
  enabled: true,
  deprecatedAt: null,
};
