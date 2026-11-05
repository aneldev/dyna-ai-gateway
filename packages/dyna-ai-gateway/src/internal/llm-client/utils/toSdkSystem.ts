import {SystemModelMessage} from "ai";

import {EModelProvider} from "../../model-registry";

import {ISystemBlock} from "../types";
import {joinSystem} from "../joinSystem";

/** The cache marker of the providers that take one on a system message; a provider missing here gets the joined string. */
const CACHE_MARKERS: Partial<Record<EModelProvider, SystemModelMessage["providerOptions"]>> = {
  [EModelProvider.ANTHROPIC]: {anthropic: {cacheControl: {type: "ephemeral"}}},
  [EModelProvider.BEDROCK]: {bedrock: {cachePoint: {type: "default"}}},
};

/**
 * toSdkSystem -- the system prompt as the provider takes it
 *
 * # About
 *
 * > One message per block with the cache marker where the provider has one; one string otherwise.
 *
 * A provider in `CACHE_MARKERS` (Anthropic: `cache_control: ephemeral`, the 5-minute cache; Amazon Bedrock: a `cachePoint`),
 * with a `cache` block: one system message per block, the `cache` block carrying the marker. Every other case: the texts
 * joined (`joinSystem`), byte-for-byte the prompt before the blocks existed (D123).
 *
 * # Who needs it
 *
 * `LLMClient.complete`, on every call.
 */
export const toSdkSystem = (
  {
    blocks,
    provider,
  }: {
    blocks: ISystemBlock[];
    provider: EModelProvider;
  },
): string | SystemModelMessage[] => {
  const marker = CACHE_MARKERS[provider];
  if (marker === undefined || !blocks.some(block => block.cache)) return joinSystem({blocks});
  return blocks.map(block => ({
    role: "system",
    content: block.text,
    ...block.cache && {providerOptions: marker},
  }));
};
