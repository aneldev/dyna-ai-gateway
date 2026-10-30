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
 * Our system blocks → the SDK's `system`. A provider that takes a cache marker (Anthropic: `cache_control: ephemeral`, the
 * 5-minute cache; Amazon Bedrock: a `cachePoint`), with a `cache` block: one system message per block, the `cache` block
 * carrying the marker. Every other case: the texts joined as one string, byte-for-byte the prompt before the blocks existed.
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
