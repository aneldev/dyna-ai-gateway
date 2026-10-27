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

/** The SDK embedding model of a registry entry. Throws a 400 for a provider whose SDK adapter has no embedding model (Anthropic). */
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
