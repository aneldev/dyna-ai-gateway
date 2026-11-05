import {LanguageModel} from "ai";
import {createAmazonBedrock} from "@ai-sdk/amazon-bedrock";
import {createAnthropic} from "@ai-sdk/anthropic";
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
 * createLanguageModel -- the SDK language model of a registry entry
 *
 * # About
 *
 * > One `case` per `EModelProvider`; the credentials from the config (D84).
 *
 * Builds the provider's SDK client (OpenAI, Anthropic, Google, Mistral, Amazon Bedrock) with the key, the base URL and, for
 * Bedrock, the region, and returns its model for the entry's `providerModelId`. A provider without a `case` is a 400; today
 * every member of the enum has one.
 *
 * # Who needs it
 *
 * `LLMClient.complete`, on every call.
 */
export const createLanguageModel = (
  {
    model,
    credentials,
  }: {
    model: IModelInfo;
    credentials: IProviderCredentials;
  },
): LanguageModel => {
  switch (model.provider) {
    case EModelProvider.OPENAI:
      return createOpenAI({
        apiKey: credentials.apiKey,
        baseURL: credentials.baseUrl,
      })(model.providerModelId);
    case EModelProvider.ANTHROPIC:
      return createAnthropic({
        apiKey: credentials.apiKey,
        baseURL: credentials.baseUrl,
      })(model.providerModelId);
    case EModelProvider.GOOGLE:
      return createGoogleGenerativeAI({
        apiKey: credentials.apiKey,
        baseURL: credentials.baseUrl,
      })(model.providerModelId);
    case EModelProvider.MISTRAL:
      return createMistral({
        apiKey: credentials.apiKey,
        baseURL: credentials.baseUrl,
      })(model.providerModelId);
    case EModelProvider.BEDROCK:
      return createAmazonBedrock({
        apiKey: credentials.apiKey,
        region: credentials.region,
        baseURL: credentials.baseUrl,
      })(model.providerModelId);
    default:
      throw dynaError({
        code: 5372567786184,
        status: 400,
        message: `LLMClient: no SDK adapter for provider [${model.provider}] (model [${model.id}])`,
        data: {
          provider: model.provider,
          modelId: model.id,
        },
      });
  }
};
