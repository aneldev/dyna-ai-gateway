import {generateText} from "ai";
import {createHash} from "node:crypto";

import {EModelProvider} from "../../model-registry";

import {ISystemBlock} from "../types";

/** Length of the cache key: 16 hex characters of the SHA-256 identify the block without carrying its text. */
const PROMPT_CACHE_KEY_LENGTH = 16;

/** The SDK's call-level provider options; `ai` 7 does not export the type by name. */
export type TSdkProviderOptions = Parameters<typeof generateText>[0]["providerOptions"];

/**
 * Our system blocks → the SDK's call-level `providerOptions`. OpenAI, with a `cache` block: `openai.promptCacheKey` is the
 * 16-hex SHA-256 of that block's text, so the provider routes the calls that share the stable block to one cache; the key
 * names exactly the calls that may share it (per tenant when the block opens with the tenant-scope line, across tenants
 * when sharing is on). Every other case: no options, byte-for-byte the request before the blocks existed.
 */
export const toSdkProviderOptions = (
  {
    blocks,
    provider,
  }: {
    blocks: ISystemBlock[];
    provider: EModelProvider;
  },
): TSdkProviderOptions => {
  if (provider !== EModelProvider.OPENAI) return undefined;
  const cacheBlock = blocks.find(block => block.cache);
  if (cacheBlock === undefined) return undefined;
  const promptCacheKey = createHash("sha256")
    .update(cacheBlock.text)
    .digest("hex")
    .slice(0, PROMPT_CACHE_KEY_LENGTH);
  return {openai: {promptCacheKey}};
};
