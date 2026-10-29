import {SystemModelMessage} from "ai";

import {EModelProvider} from "../../model-registry";

import {ISystemBlock} from "../types";
import {joinSystem} from "../joinSystem";

/**
 * Our system blocks → the SDK's `system`. Anthropic, with a `cache` block: one system message per block, the `cache` block
 * carrying the provider's cache marker (`cache_control: ephemeral`, the 5-minute cache). Every other case: the texts
 * joined as one string, byte-for-byte the prompt before the blocks existed.
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
  if (provider !== EModelProvider.ANTHROPIC || !blocks.some(block => block.cache)) return joinSystem({blocks});
  return blocks.map(block => ({
    role: "system",
    content: block.text,
    ...block.cache && {providerOptions: {anthropic: {cacheControl: {type: "ephemeral"}}}},
  }));
};
