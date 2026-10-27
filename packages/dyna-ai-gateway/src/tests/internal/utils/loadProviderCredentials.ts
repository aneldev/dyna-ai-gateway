import {join} from "node:path";

import * as dotenv from "dotenv";

import {
  ILLMClientConfig,
  IProviderCredentials,
  EModelProvider,
} from "../../..";

/** The variable of the repo-root `.env` that holds the key of each provider (see `.env.sample`); used by the base test config only. */
export const PROVIDER_API_KEY_ENV_VARS: Record<EModelProvider, string> = {
  [EModelProvider.OPENAI]: "AIGATEWAY_TEST_OPENAI_API_KEY",
  [EModelProvider.ANTHROPIC]: "AIGATEWAY_TEST_ANTHROPIC_API_KEY",
  [EModelProvider.GOOGLE]: "AIGATEWAY_TEST_GOOGLE_API_KEY",
  [EModelProvider.MISTRAL]: "AIGATEWAY_TEST_MISTRAL_API_KEY",
  [EModelProvider.BEDROCK]: "AIGATEWAY_TEST_BEDROCK_API_KEY",
};

/** The variable that holds the AWS region of the Bedrock tests; empty = the SDK default (`AWS_REGION`, else us-east-1). */
export const BEDROCK_REGION_ENV_VAR = "AIGATEWAY_TEST_BEDROCK_REGION";

/**
 * The credentials of every provider whose key is set in the repo-root `.env` (loaded here, once).
 * A provider without a key is left out: the LLMClient reports it when a model of that provider is called.
 * Bedrock also takes its region from `.env`; the other providers need the key only.
 */
export const loadProviderCredentials = (): ILLMClientConfig["providers"] => {
  dotenv.config({path: join(__dirname, "..", "..", "..", "..", "..", "..", ".env")});
  return Object.fromEntries(
    Object.values(EModelProvider)
      .map((provider): [EModelProvider, string] => [provider, process.env[PROVIDER_API_KEY_ENV_VARS[provider]] || ""])
      .filter(([, apiKey]) => apiKey)
      .map(([provider, apiKey]): [EModelProvider, IProviderCredentials] => [
        provider,
        provider === EModelProvider.BEDROCK
          ? {
            apiKey,
            region: process.env[BEDROCK_REGION_ENV_VAR] || undefined,
          }
          : {apiKey},
      ]),
  );
};
