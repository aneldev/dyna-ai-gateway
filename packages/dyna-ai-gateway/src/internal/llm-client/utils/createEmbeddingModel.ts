import {EmbeddingModel} from "ai";
import {createAmazonBedrock} from "@ai-sdk/amazon-bedrock";
import {createGoogleGenerativeAI} from "@ai-sdk/google";
import {createMistral} from "@ai-sdk/mistral";
import {createOpenAI} from "@ai-sdk/openai";
import {dynaError} from "dyna-error";

import {
  IModelInfo,
  EModelProvider,
} from "../../model-registry";

import {IProviderCredentials} from "../types";

/**
 * createEmbeddingModel -- the SDK embedding model of a registry entry
 *
 * # About
 *
 * > One `case` per provider that embeds; the credentials from the config.
 *
 * Builds the provider's SDK client (OpenAI, Google, Mistral, Amazon Bedrock) with the key, the base URL and, for Bedrock, the
 * region, and returns its embedding model for the entry's `providerModelId`. Anthropic has no embedding models: a 400.
 *
 * # Who needs it
 *
 * `LLMClient.embed`, on every call.
 */
export const createEmbeddingModel = (
  {
    model,
    credentials,
  }: {
    model: IModelInfo;
    credentials: IProviderCredentials;
  },
): EmbeddingModel => {
  switch (model.provider) {
    case EModelProvider.OPENAI:
      return createOpenAI({
        apiKey: credentials.apiKey,
        baseURL: credentials.baseUrl,
      }).embedding(model.providerModelId);
    case EModelProvider.GOOGLE:
      return createGoogleGenerativeAI({
        apiKey: credentials.apiKey,
        baseURL: credentials.baseUrl,
      }).embedding(model.providerModelId);
    case EModelProvider.MISTRAL:
      return createMistral({
        apiKey: credentials.apiKey,
        baseURL: credentials.baseUrl,
      }).embedding(model.providerModelId);
    case EModelProvider.BEDROCK:
      return createAmazonBedrock({
        apiKey: credentials.apiKey,
        region: credentials.region,
        baseURL: credentials.baseUrl,
      }).embedding(model.providerModelId);
    default:
      throw dynaError({
        code: 5372630367129,
        status: 400,
        message: `LLMClient: provider [${model.provider}] has no embedding models in this client (model [${model.id}])`,
        data: {
          provider: model.provider,
          modelId: model.id,
        },
      });
  }
};
